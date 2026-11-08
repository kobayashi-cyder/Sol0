"""Sol-Zero v0.10: train an offline Japanese command router FROM RANDOM WEIGHTS.

No checkpoints, pretrained tokenizers, external models, network, or knowledge distillation.
This is a narrow synthetic instruction-classification experiment, NOT a general LLM.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import math
import random
import unicodedata
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

LABELS = ('calc', 'memory', 'task', 'search', 'wsp', 'chat')
TOPICS = (
    '仕様書', '来週の予定', '明日の課題', '会話履歴', '配列の要素', '設計方針',
    'ミーティング', '次の実験', 'プロジェクト', '検証ログ', '日本語の文章', '買い物リスト',
    '数式', 'テスト', '重要事項', '開発ノート',
)
# Separate *templates*, not a random split of almost-identical instantiated samples.
TEMPLATES = {
 'calc': {
  'train': ('計算して {a}+{b}', '{a} と {b} の計算', '計算 {a} × {b}', '計算結果を出して {a}-{b}', '数式を計算 {a}+{b}', '算数の計算 {a} と {b}', '計算の練習 {a}+{b}', '計算をお願いします {a}/{b}'),
  'test': ('この計算を解いて {a}+{b}', '計算問題です {a}-{b}', '{a}×{b}を計算してください'),
 },
 'memory': {
  'train': ('覚えておいて {topic}', '記憶してください {topic}', 'メモして {topic}', 'メモに保存 {topic}', '記憶に追加 {topic}', '覚えて {topic}', 'メモを取って {topic}', '記憶内容を確認 {topic}'),
  'test': ('この情報をメモしてください {topic}', '記憶として残す {topic}', 'メモを記録して {topic}'),
 },
 'task': {
  'train': ('タスク追加 {topic}', 'タスクに登録 {topic}', 'タスクを管理 {topic}', '作業タスク {topic}', 'タスク一覧を見せて', 'タスクを完了 {topic}', '予定タスクを追加 {topic}', 'やることをタスクに登録 {topic}'),
  'test': ('タスクとして保存して {topic}', '未完了タスクを確認', '新しいタスクを作成 {topic}'),
 },
 'search': {
  'train': ('資料を検索 {topic}', '資料検索して {topic}', '文書を探して {topic}', '文章検索 {topic}', '資料を調べて {topic}', '履歴を検索 {topic}', 'ドキュメント検索 {topic}', '記録を探す {topic}'),
  'test': ('資料内を検索してください {topic}', '資料から探して {topic}', 'この資料を検索 {topic}'),
 },
 'wsp': {
  'train': ('WSPの重みを編集 {topic}', '重みを変更して {topic}', '回路を生成 {topic}', '回路設計 {topic}', 'WSP回路を検証 {topic}', '重み空間を編集 {topic}', 'ニューラル回路の重み {topic}', 'WSPの回路を作成 {topic}'),
  'test': ('回路の重みを更新 {topic}', 'WSPの回路を追加 {topic}', '重み空間の回路を検証 {topic}'),
 },
 'chat': {
  'train': ('こんにちは {topic}', '今日もよろしく', 'お話ししよう {topic}', '雑談して {topic}', '会話しましょう {topic}', '話を聞いて {topic}', 'ひとこと会話 {topic}', '楽しく雑談 {topic}'),
  'test': ('こんにちは少し雑談しましょう', '会話を続けよう {topic}', '雑談を楽しみたい {topic}'),
 },
}

BUCKETS = 4096

def normalize(text: str) -> str:
    return unicodedata.normalize('NFKC', text).strip().lower()

def ngrams(text: str) -> list[int]:
    chars = list('^' + normalize(text) + '$')
    ids = []
    for n in (2,3,4):
        for i in range(len(chars) - n + 1):
            h = 2166136261
            for ch in chars[i:i+n]:
                h ^= ord(ch)
                h = (h * 16777619) & 0xFFFFFFFF
            ids.append(h % BUCKETS)
    return ids or [0]

def make_samples(split: str, seed: int) -> list[tuple[str,int,str]]:
    rng = random.Random(seed)
    samples = []
    for idx, label in enumerate(LABELS):
        for tid, fmt in enumerate(TEMPLATES[label][split]):
            for k in range(24 if split == 'train' else 18):
                a,b=rng.randrange(1,90),rng.randrange(1,90)
                topic=TOPICS[rng.randrange(len(TOPICS))]
                s=fmt.format(a=a,b=b,topic=topic)
                samples.append((s,idx,f'{label}/{split}/{tid}'))
    rng.shuffle(samples)
    return samples

def batch_ids(samples):
    flat, offsets, targets = [], [], []
    for text, y, _ in samples:
        offsets.append(len(flat))
        flat.extend(ngrams(text))
        targets.append(y)
    offsets.append(len(flat))
    return (torch.tensor(flat,dtype=torch.long),
            torch.tensor(offsets,dtype=torch.long),
            torch.tensor(targets,dtype=torch.long))

class TrainableRouter(nn.Module):
    def __init__(self):
        super().__init__()
        self.table = nn.EmbeddingBag(BUCKETS,len(LABELS), mode='mean',include_last_offset=True)
        self.bias = nn.Parameter(torch.zeros(len(LABELS)))
        nn.init.normal_(self.table.weight, std=0.02)
    def forward(self, idx, offsets):
        return self.table(idx,offsets)+self.bias

@torch.no_grad()
def score(model, samples):
    model.eval()
    fi, offs, targets=batch_ids(samples)
    logits=model(fi,offs)
    pred=logits.argmax(dim=-1)
    return dict(accuracy=float((pred==targets).float().mean().item()),
                correct=int((pred==targets).sum().item()),total=len(samples),
                loss=float(F.cross_entropy(logits,targets).item()))

def export(model):
    w=model.table.weight.detach().cpu()
    scale=float(w.abs().max()/127)
    assert scale>0
    q=torch.clamp(torch.round(w/scale),-127,127).to(torch.int8).contiguous()
    # Signed int8 bytes; JS decoder reads Int8Array over the decoded bytes.
    weights=base64.b64encode(q.numpy().tobytes()).decode('ascii')
    return dict(format='solzero-ngrams-int8-v1',labels=list(LABELS),buckets=BUCKETS,
                ngrams=[2,3,4],scale=scale,bias=[float(x) for x in model.bias.detach()],
                weights_b64=weights,weights_sha256=hashlib.sha256(q.numpy().tobytes()).hexdigest(),
                source='random-initialized CPU training, no pretrained weights')

def run(out: Path, epochs:int=32, seed:int=20261106):
    torch.set_num_threads(1)
    torch.manual_seed(seed)
    train=make_samples('train',seed)
    test=make_samples('test',seed+1)
    assert not set(x for x,_,_ in train)&set(x for x,_,_ in test)
    model=TrainableRouter()
    baseline=score(model,test)
    opt=torch.optim.AdamW(model.parameters(),lr=0.3,weight_decay=0.0001)
    curve=[]
    rng=random.Random(seed)
    for epoch in range(epochs):
        rng.shuffle(train)
        model.train()
        for start in range(0,len(train),64):
            x,offs,y=batch_ids(train[start:start+64])
            opt.zero_grad()
            loss=F.cross_entropy(model(x,offs),y)
            loss.backward()
            opt.step()
        if epoch in (0,1,3,7,15,epochs-1):
            curve.append({'epoch':epoch+1,'train':score(model,train),'holdout':score(model,test)})
    final=score(model,test)
    exported=export(model)
    # Verify quantized inference on heldout via numpy-independent torch arithmetic.
    q=torch.frombuffer(bytearray(base64.b64decode(exported['weights_b64'])),dtype=torch.int8).clone().view(BUCKETS,len(LABELS))
    correct=0
    for s,y,_ in test:
        ids=ngrams(s)
        logits=(q[ids].float().mean(dim=0)*exported['scale'])+torch.tensor(exported['bias'])
        correct+=int(int(logits.argmax())==y)
    quant={'correct':correct,'total':len(test),'accuracy':correct/len(test)}
    report={'task':'synthetic Japanese intent classification (six labels)',
       'constraint':'no pretrained weights / tokenizer / teacher',
       'split':'distinct train and holdout templates; unique examples',
       'seed':seed, 'epochs':epochs, 'train_examples':len(train), 'holdout_examples':len(test),
       'parameters':sum(p.numel() for p in model.parameters()),
       'baseline':baseline, 'final':final, 'quantized':quant,'curve':curve,
       'scope':'narrow classification only; not natural language understanding or general intelligence'}
    out.mkdir(parents=True,exist_ok=True)
    (out/'intent_weights_v010.json').write_text(json.dumps(exported,ensure_ascii=False, separators=(',',':')),encoding='utf8')
    (out/'intent_training_report_v010.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    (out/'test_templates_manifest_v010.json').write_text(json.dumps({k:v['test'] for k,v in TEMPLATES.items()},ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k!='curve'}, ensure_ascii=False,indent=2))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--epochs',type=int,default=32);parser.add_argument('--out',type=Path,default=Path(__file__).resolve().parents[1]/'artifacts');args=parser.parse_args()
    run(args.out,epochs=args.epochs)
