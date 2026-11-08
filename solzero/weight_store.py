"""Disk-backed 4-bit WSP storage; NO pretrained parameters or LLM.

Format: packed two's-complement signed 4bit integers (-8..7).
This is a storage/patching substrate, NOT a neural inference engine.
The raw storage can be much larger than RAM via mmap.
"""
from __future__ import annotations

import json
import math
import mmap
import os
from pathlib import Path
from typing import Iterable

MAX_DISTRIBUTION_BYTES = 5_000_000_000  # 5 decimal GB
MAX_PATCH = 2048


def packed_size(shape: Iterable[int]) -> int:
    dims = list(shape)
    if not (1 <= len(dims) <= 5) or not all(type(d) is int and 1 <= d <= 9_999_999_999 for d in dims):
        raise ValueError('shape must be 1..5 positive integer dimensions')
    count = math.prod(dims)
    size = (count + 1) // 2
    if size >= MAX_DISTRIBUTION_BYTES - 1_000_000:
        raise ValueError('5GB package budget exceeded')
    return size


class WeightStore4:
    """Sparse on-demand writes and reversible patches to a packed weight file."""

    def __init__(self, base_path):
        self.base = Path(base_path)
        self.info_path = self.base.with_suffix('.sz4.json')
        self.data_path = self.base.with_suffix('.sz4.bin')
        self.meta = json.loads(self.info_path.read_text('utf-8'))
        if self.meta.get('magic') != 'SOLZERO4' or self.meta.get('version') != 1:
            raise ValueError('invalid metadata format')
        self.shape = tuple(self.meta['shape'])
        self.size = packed_size(self.shape)
        if self.size != self.data_path.stat().st_size or self.meta.get('size') != self.size:
            raise ValueError('weight file metadata and length disagree')
        self.count = math.prod(self.shape)
        self._file = self.data_path.open('r+b')
        self._mmap = mmap.mmap(self._file.fileno(), 0)

    @classmethod
    def create(cls, base_path, shape, *, overwrite=False):
        base = Path(base_path)
        info = base.with_suffix('.sz4.json')
        data = base.with_suffix('.sz4.bin')
        dims = list(shape)
        size = packed_size(dims)
        if info.exists() or data.exists():
            if not overwrite:
                raise FileExistsError('refusing to replace existing weights')
            info.unlink(missing_ok=True)
            data.unlink(missing_ok=True)
        base.parent.mkdir(parents=True, exist_ok=True)
        with data.open('wb') as fh:
            fh.truncate(size)  # file is all zero weights, no pretrained import
        meta = {'magic':'SOLZERO4','version':1,'shape':dims,'size':size,'journal':[]}
        info.write_text(json.dumps(meta, separators=(',',':')),encoding='utf-8')
        return cls(base)

    def close(self):
        if getattr(self, '_mmap', None) is not None:
            self._mmap.flush();self._mmap.close();self._mmap=None
        if getattr(self, '_file', None) is not None:
            self._file.close();self._file=None

    def __enter__(self): return self
    def __exit__(self, *args): self.close()

    def _flat_index(self, index):
        if type(index) is int:
            i=index
        elif isinstance(index, (list,tuple)) and len(index)==len(self.shape):
            i=0
            for j,limit in zip(index,self.shape):
                if type(j) is not int or not 0 <= j < limit:
                    raise IndexError('weight index out of bounds')
                i=i*limit+j
        else:
            raise IndexError('index must be flat integer or full coordinate tuple')
        if not 0 <= i < self.count:
            raise IndexError('weight index out of bounds')
        return i

    def _get_flat(self, i):
        raw=self._mmap[i//2]
        nib=(raw&15) if i%2==0 else (raw>>4)
        return nib-16 if nib>=8 else nib

    def get(self, index):
        return self._get_flat(self._flat_index(index))

    def _set_flat(self, i, v):
        k=i//2;old=self._mmap[k];n=v&15
        self._mmap[k]=(old&240)|n if i%2==0 else (old&15)|(n<<4)

    def _write_meta(self):
        tmp=self.info_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.meta,separators=(',',':')),encoding='utf-8')
        os.replace(tmp,self.info_path)

    def patch(self, changes):
        """changes=[(index, signed_int4), ...] validated before mutation."""
        if not isinstance(changes,(list,tuple)) or not 1<=len(changes)<=MAX_PATCH:
            raise ValueError('patch must contain 1..2048 changes')
        staged=[];seen=set()
        for entry in changes:
            if not isinstance(entry,(list,tuple)) or len(entry)!=2:
                raise ValueError('patch entries must be pairs')
            i=self._flat_index(entry[0]);v=entry[1]
            if i in seen:
                raise ValueError('duplicate weight coordinate')
            if type(v) is not int or not -8<=v<=7:
                raise ValueError('4-bit value outside -8..7')
            seen.add(i);staged.append([i,self._get_flat(i),v])
        oldjournal=list(self.meta.get('journal',[]))
        try:
            for i,old,new in staged:self._set_flat(i,new)
            self._mmap.flush()
            self.meta['journal']=(oldjournal+[staged])[-8:]
            self._write_meta()
        except BaseException:
            for i,old,new in staged:self._set_flat(i,old)
            self._mmap.flush();self.meta['journal']=oldjournal
            raise
        return {'updated':len(staged),'undo_depth':len(self.meta['journal'])}

    def undo(self):
        journal=self.meta.get('journal',[])
        if not journal:return False
        latest=journal[-1]
        # Avoid undoing altered weight values from a corrupted journal.
        if any(self._get_flat(i)!=new for i,old,new in latest):
            raise ValueError('journal does not match current weights')
        for i,old,new in latest:self._set_flat(i,old)
        self._mmap.flush()
        self.meta['journal']=journal[:-1]
        self._write_meta()
        return True

    def stats(self):
        return {'shape':list(self.shape),'parameters':self.count,
                'packed_weight_bytes':self.size,'journal_transactions':len(self.meta.get('journal',[])),
                'distribution_budget_bytes':MAX_DISTRIBUTION_BYTES}
