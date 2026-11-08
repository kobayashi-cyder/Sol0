from pathlib import Path
import pytest
from solzero.weight_store import WeightStore4,packed_size,MAX_DISTRIBUTION_BYTES


def test_packing_and_odd_size(tmp_path):
    with WeightStore4.create(tmp_path/'odd',[7]) as m:
        assert m.size==4
        assert [m.get(i) for i in range(7)]==[0]*7
        assert m.patch([(0,-8),(1,7),(6,-1)])['updated']==3
        assert [m.get(i) for i in [0,1,6]]==[-8,7,-1]
        assert m.data_path.stat().st_size==4


def test_coordinate_multi_dimensional(tmp_path):
    with WeightStore4.create(tmp_path/'matrix',[5,9]) as m:
        m.patch([((4,8),-3),((0,2),5)])
        assert m.get((4,8))==-3
        assert m.get(44)==-3
        assert m.get((0,2))==5


def test_reopen_and_undo(tmp_path):
    path=tmp_path/'persist'
    with WeightStore4.create(path,[5]) as m:m.patch([(2,7)])
    with WeightStore4(path) as m:
        assert m.get(2)==7
        assert m.undo() is True
        assert m.undo() is False
        assert m.get(2)==0


def test_invalid_patch_atomic(tmp_path):
    with WeightStore4.create(tmp_path/'atomic',[9]) as m:
        for changes in [[(1,1),(2,99)],[(1,1),(1,2)],[(9,7)],[(2,2.2)]]:
            with pytest.raises((ValueError,IndexError)):m.patch(changes)
        assert [m.get(i) for i in range(9)]==[0]*9
        assert m.stats()['journal_transactions']==0


def test_overwrite_protected(tmp_path):
    path=tmp_path/'no-overwrite'
    with WeightStore4.create(path,[16]):pass
    with pytest.raises(FileExistsError):WeightStore4.create(path,[16])


def test_reject_unbounded_weights():
    with pytest.raises(ValueError):packed_size([11_000_000_000])
    assert packed_size([2_818_735_104])==1_409_367_552
    assert MAX_DISTRIBUTION_BYTES==5_000_000_000


def test_disk_mmap_one_million_without_model_checkpoint(tmp_path):
    with WeightStore4.create(tmp_path/'million',[1_000_000]) as m:
        assert m.size==500000
        m.patch([((999999,),7),(0,-8)])
        assert m.get(999999)==7 and m.get(0)==-8
        assert m.stats()['parameters']==1_000_000
