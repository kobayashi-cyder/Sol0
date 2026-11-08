/** Sol-Zero Code Workshop v0.13.
 * Deterministic, offline, auditable algorithm emitters; no pretrained models,
 * network, dynamic compilation, eval, Function, or execution of user code.
 * It deliberately refuses tasks outside the supported catalogue.
 */
const CATALOGUE = Object.freeze({
  factorial: {label:'階乗', aliases:['factorial','階乗','かいじょう'],fn:'factorial',args:['5'],value:'120',
    python:`def factorial(n):
    """Return n! for a nonnegative integer."""
    if type(n) is not int or n < 0:
        raise ValueError("n must be a nonnegative integer")
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result`,
    javascript:`function factorial(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 18) {
    throw new RangeError('n must be an integer from 0 to 18');
  }
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}`},
  fibonacci: {label:'フィボナッチ数',aliases:['fibonacci','フィボナッチ','fib'],fn:'fibonacci',args:['10'],value:'55',
    python:`def fibonacci(n):
    """Return the zero-indexed nth Fibonacci number."""
    if type(n) is not int or n < 0:
        raise ValueError("n must be a nonnegative integer")
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a`,
    javascript:`function fibonacci(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 78) {
    throw new RangeError('n must be an integer from 0 to 78');
  }
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}`},
  binary_search:{label:'昇順配列の二分探索',aliases:['binary_search','binary search','二分探索'],fn:'binary_search',args:['[1, 2, 2, 3]','2'],value:'1',
    python:`def binary_search(items, target):
    """Return the first index of target in a sorted ascending sequence, or -1."""
    left, right = 0, len(items)
    while left < right:
        mid = (left + right) // 2
        if items[mid] < target:
            left = mid + 1
        else:
            right = mid
    return left if left < len(items) and items[left] == target else -1`,
    javascript:`function binary_search(items, target) {
  let left = 0, right = items.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (items[mid] < target) left = mid + 1;
    else right = mid;
  }
  return left < items.length && items[left] === target ? left : -1;
}`},
  unique:{label:'重複除去（順序維持）',aliases:['dedupe','deduplicate','unique','重複除去','重複削除'],fn:'unique',args:['[2, 1, 2, 3, 1]'],value:'[2,1,3]',
    python:`def unique(items):
    """Keep first occurrences in order, including unhashable values."""
    result = []
    for item in items:
        if item not in result:
            result.append(item)
    return result`,
    javascript:`function unique(items) {
  const result = [];
  for (const item of items) {
    if (!result.some(v => Object.is(v, item))) result.push(item);
  }
  return result;
}`},
  palindrome:{label:'回文判定',aliases:['palindrome','回文'],fn:'palindrome',args:['"RaceCar"'],value:'true',
    python:`def palindrome(text):
    """Check whether alphanumeric characters form a case-insensitive palindrome."""
    cleaned = ''.join(c.casefold() for c in text if c.isalnum())
    return cleaned == cleaned[::-1]`,
    javascript:`function palindrome(text) {
  const cleaned = Array.from(String(text).toLowerCase())
    .filter(c => /[\\p{L}\\p{N}]/u.test(c)).join('');
  return cleaned === Array.from(cleaned).reverse().join('');
}`},
  mean:{label:'算術平均',aliases:['average','mean','平均'],fn:'mean',args:['[2, 4, 6]'],value:'4',
    python:`def mean(values):
    """Return the arithmetic mean of a nonempty numeric sequence."""
    if not values:
        raise ValueError("values must not be empty")
    return sum(values) / len(values)`,
    javascript:`function mean(values) {
  if (!Array.isArray(values) || values.length === 0 ||
      !values.every(x => typeof x === 'number' && Number.isFinite(x))) {
    throw new TypeError('values must be a nonempty numeric array');
  }
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}`},
  csv_escape:{label:'CSVフィールド引用',aliases:['csv_escape','csv escape','csvエスケープ','csv引用','csv'],fn:'csv_escape',args:['"a,b"'],value:'"\\\"a,b\\\""',
    python:`def csv_escape(value):
    """Quote one RFC 4180 CSV field if it contains a delimiter, quote or newline."""
    text = str(value)
    if any(c in text for c in ',"\\r\\n'):
        return '"' + text.replace('"', '""') + '"'
    return text`,
    javascript:`function csv_escape(value) {
  const text = String(value);
  return /[,"\\r\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}`},
  clamp:{label:'数値を範囲に制限',aliases:['clamp','範囲制限','クリップ'],fn:'clamp',args:['12','0','10'],value:'10',
    python:`def clamp(value, low, high):
    """Constrain a number to an inclusive interval."""
    if low > high:
        raise ValueError("low must not exceed high")
    return max(low, min(value, high))`,
    javascript:`function clamp(value, low, high) {
  if (![value, low, high].every(Number.isFinite) || low > high) {
    throw new RangeError('invalid numeric interval');
  }
  return Math.max(low, Math.min(value, high));
}`}
});
export const CODE_TASKS = Object.freeze(Object.keys(CATALOGUE));
export function codeHelp() {
  return '利用可能なコード生成：' + CODE_TASKS.map(k=>CATALOGUE[k].label + '(' + k + ')').join('、') +
    '\n使い方：/code python fibonacci または /code javascript binary_search\n' +
    '固定済みアルゴリズムのソースを端末内で生成・コピーします。自由なコーディングAIや実行環境ではありません。';
}
export function generateCode(request) {
  const source=String(request??'');
  if(source.length>512 && /^\s*(?:\/code|コード生成|コード作成)/iu.test(source.slice(0,32)))
    return {ok:false,message:'コード生成の入力は512文字以内にしてください。'};
  const raw=source.normalize('NFKC').trim();
  const match=raw.match(/^(?:\/code|コード生成|コード作成)(?:\s+|$)(.*)$/iu);
  if(!match)return null;
  const query=match[1].trim().toLowerCase();
  if(!query || /^(?:help|list|一覧|ヘルプ)$/u.test(query))return {ok:false,message:codeHelp()};
  // Parse one exact language and one exact known algorithm. Unknown modifiers
  // must not be silently dropped: they can change the requested behavior.
  const parsed=query.match(/^(python|py|javascript|js)\s+(.+)$/u);
  if(!parsed)return {ok:false,message:'言語を python または javascript のどちらか1つ指定してください。\n'+codeHelp()};
  const language=(parsed[1]==='python'||parsed[1]==='py')?'python':'javascript';
  const requested=parsed[2].trim();
  const hits=Object.entries(CATALOGUE).filter(([,task])=>task.aliases.some(alias=>alias===requested));
  if(hits.length!==1)return {ok:false,message:'対応アルゴリズムが見つからないか、未対応の追加条件が含まれています。一覧から1つ正確に指定してください。\n'+codeHelp()};
  const [task,def]=hits[0];
  const code=def[language];
  const ext=language==='python'?'py':'js';
  const runHint=language==='python'?`python ${task}.py`:`node ${task}.js`;
  return {ok:true,task,language,label:def.label,filename:`${task}.${ext}`,code,
    example:`${def.fn}(${def.args.join(', ')})`,runHint,
    message:`［Sol-Zero固定アルゴリズム生成：${def.label} / ${language}］\nファイル名：${task}.${ext}\n\n${code}\n\n使用例：${def.fn}(${def.args.join(', ')})\n※コードは端末で実行せず、コピー用テキストとして出力します。`};
}