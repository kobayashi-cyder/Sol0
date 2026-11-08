/** Compile a validated WSP numeric graph into stand-alone Python or JavaScript.
 * No pretrained models, arbitrary code interpretation, eval, Function or network.
 * Export only a bounded, validated graph: this is an interpreter transpilation,
 * not natural-language program synthesis.
 */
import {inspectGraph} from './wsp_graph.js';

export const WSP_EXPORT_LIMIT = 120_000;

const JS_RUNTIME = String.raw`
'use strict';
function wsp_predict(inputs) {
  if (!Array.isArray(inputs) || inputs.length !== GRAPH.inputs.length) throw new Error('input shape');
  const finite=(v,b)=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>b)throw new Error('nonfinite/out-of-range numeric value');return v;};
  const act=(v,op,t=.5)=>{
    switch(op){
      case 'identity':return v;
      case 'relu':return Math.max(v,0);
      case 'tanh':return Math.tanh(v);
      case 'sigmoid':return v>=0?1/(1+Math.exp(-v)):Math.exp(v)/(1+Math.exp(v));
      case 'threshold':return v>=t?1:0;
      case 'abs':return Math.abs(v);
      case 'negate':return -v;
      case 'square':return v*v;
      case 'sign':return Math.sign(v);
      case 'sin':return Math.sin(v);
      case 'cos':return Math.cos(v);
      case 'sqrtabs':return Math.sqrt(Math.abs(v));
      default:throw new Error('invalid activation');
    }
  };
  const vars=Object.create(null);
  GRAPH.inputs.forEach((k,i)=>{vars[k]=[finite(inputs[i],1e6)];});
  let work=0;
  for(const n of GRAPH.nodes){
    let out;
    if(n.op==='constant'){out=n.value.slice();}
    else {
      const arrays=n.from.map(k=>vars[k]),flat=arrays.flat();
      if(n.op==='linear')out=n.weights.map((row,i)=>{
        let v=n.bias[i];for(let k=0;k<row.length;k++)v+=row[k]*flat[k];
        return act(finite(v,1e12),n.activation);
      });
      else if(n.op==='softmax'){
        const max=Math.max(...flat),exps=flat.map(v=>Math.exp(v-max));
        const z=exps.reduce((a,b)=>a+b,0);out=exps.map(v=>v/z);
      }else if(n.op==='l2norm'){
        const norm=Math.hypot(...flat);out=norm===0?flat.map(()=>0):flat.map(v=>v/norm);
      }else if(['relu','tanh','sigmoid','abs','threshold','negate','square','sign','sin','cos','sqrtabs'].includes(n.op))
        out=flat.map(v=>act(v,n.op,n.threshold));
      else if(n.op==='concat')out=flat;
      else if(n.op==='sum')out=[flat.reduce((a,b)=>a+b,0)];
      else if(n.op==='mean')out=[flat.reduce((a,b)=>a+b,0)/flat.length];
      else if(n.op==='pick')out=[flat[n.index]];
      else if(n.op==='dot')out=[arrays[0].reduce((a,v,i)=>a+v*arrays[1][i],0)];
      else out=arrays[0].map((_,i)=>{
        const c=arrays.map(a=>a[i]);
        if(n.op==='add')return c.reduce((a,b)=>a+b,0);
        if(n.op==='multiply')return c.reduce((a,b)=>a*b,1);
        if(n.op==='maximum')return Math.max(...c);
        if(n.op==='minimum')return Math.min(...c);
        throw new Error('invalid graph operation');
      });
    }
    out.forEach(v=>finite(v,1e12));work+=out.length;
    if(work>3000000)throw new Error('graph computation budget exceeded');
    vars[n.id]=out;
  }
  return Object.fromEntries(GRAPH.outputs.map(k=>[k,vars[k]]));
}
`;

const PY_RUNTIME = String.raw`
import json
import math

def wsp_predict(inputs):
    if not isinstance(inputs, (list, tuple)) or len(inputs) != len(GRAPH['inputs']):
        raise ValueError('input shape')

    def finite(value, bound):
        if type(value) not in (float, int) or not math.isfinite(value) or abs(value) > bound:
            raise ValueError('nonfinite/out-of-range numeric value')
        return value

    def act(value, op, threshold=0.5):
        if op == 'identity': return value
        if op == 'relu': return max(value, 0)
        if op == 'tanh': return math.tanh(value)
        if op == 'sigmoid':
            return 1/(1+math.exp(-value)) if value >= 0 else math.exp(value)/(1+math.exp(value))
        if op == 'threshold': return 1 if value >= threshold else 0
        if op == 'abs': return abs(value)
        if op == 'negate': return -value
        if op == 'square': return value*value
        if op == 'sign': return 1 if value > 0 else (-1 if value < 0 else 0)
        if op == 'sin': return math.sin(value)
        if op == 'cos': return math.cos(value)
        if op == 'sqrtabs': return math.sqrt(abs(value))
        raise ValueError('invalid activation')

    values = {name: [finite(x, 1e6)] for name, x in zip(GRAPH['inputs'], inputs)}
    work = 0
    for node in GRAPH['nodes']:
        op = node['op']
        if op == 'constant':
            out = node['value'][:]
        else:
            arrays = [values[k] for k in node['from']]
            flat = [v for a in arrays for v in a]
            if op == 'linear':
                out = []
                for i, row in enumerate(node['weights']):
                    v = node['bias'][i]
                    for k, w in enumerate(row): v += w*flat[k]
                    out.append(act(finite(v, 1e12), node['activation']))
            elif op == 'softmax':
                high = max(flat)
                exps = [math.exp(v-high) for v in flat]
                z = sum(exps)
                out = [v/z for v in exps]
            elif op == 'l2norm':
                norm = math.hypot(*flat)
                out = [0 for _ in flat] if norm == 0 else [v/norm for v in flat]
            elif op in ('relu','tanh','sigmoid','abs','threshold','negate','square','sign','sin','cos','sqrtabs'):
                out = [act(v, op, node.get('threshold', 0.5)) for v in flat]
            elif op == 'concat': out = flat
            elif op == 'sum': out = [sum(flat)]
            elif op == 'mean': out = [sum(flat)/len(flat)]
            elif op == 'pick': out = [flat[node['index']]]
            elif op == 'dot': out = [sum(v*w for v,w in zip(arrays[0], arrays[1]))]
            elif op in ('add','multiply','maximum','minimum'):
                out = []
                for items in zip(*arrays):
                    if op == 'add': out.append(sum(items))
                    elif op == 'multiply': out.append(math.prod(items))
                    elif op == 'maximum': out.append(max(items))
                    else: out.append(min(items))
            else: raise ValueError('invalid graph operation')
        for v in out: finite(v, 1e12)
        work += len(out)
        if work > 3_000_000: raise ValueError('graph computation budget exceeded')
        values[node['id']] = out
    return {k: values[k] for k in GRAPH['outputs']}
`;

/** @returns {{language: string, filename: string, code: string, nodes: number, weights: number}} */
export function generateWSPCode(raw, language) {
  const lang = String(language ?? '').trim().toLowerCase();
  if (!['python', 'javascript'].includes(lang)) throw Error('言語は python または javascript を指定してください');
  const checked=inspectGraph(raw); // sanitize and validate before string interpolation
  const compact=JSON.stringify(checked.spec);
  if(compact.length>WSP_EXPORT_LIMIT)throw Error('回路が大きすぎてコードに埋め込めません（120KB上限）。JSON回路として保存してください。');
  const source=lang==='javascript' ?
    '// Sol-Zero export: validated numeric WSP graph (not a trained language model).\n' +
    'const GRAPH = ' + compact + ';\n' + JS_RUNTIME :
    '# Sol-Zero export: validated numeric WSP graph (not a trained language model).\n' +
    'GRAPH = __import__("json").loads(' + JSON.stringify(compact) + ')\n' + PY_RUNTIME;
  return {language:lang,filename:lang==='python'?'solzero_wsp.py':'solzero_wsp.js',
    code:source,nodes:checked.stats.nodes,weights:checked.stats.weights};
}