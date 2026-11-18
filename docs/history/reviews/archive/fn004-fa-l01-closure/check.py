import pathlib,re,subprocess,json,urllib.parse
root=pathlib.Path.cwd(); files=['docs/design/FN-004-'+n+'.md' for n in ['判断モデル','反映計画','反映処理・復旧']]
results=[]; links=fragments=0
for f in files:
 s=(root/f).read_text(); old=subprocess.check_output(['git','show','HEAD^1:'+f]).decode()
 assert re.findall(r'^\|.*$',s,re.M)==re.findall(r'^\|.*$',old,re.M)
 assert re.findall(r'```[\s\S]*?```',s)==re.findall(r'```[\s\S]*?```',old)
 for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)',s):
  if '://' in target: continue
  path,_,frag=urllib.parse.unquote(target).partition('#'); p=(root/f).parent/path if path else root/f
  assert p.exists(),(f,target);links+=1
  if frag:
   fragments+=1
   headings=re.findall(r'^#+\s+(.+)$',p.read_text(),re.M)
   slugs=[re.sub(r'[^\w\-\s]','',h.replace('`','').lower()).replace(' ','-') for h in headings]
   assert frag in slugs,(target,slugs)
 results.append({'file':f,'tables_identical':True,'fenced_blocks_identical':True,'runtime_unimplemented_lines':[l for l in s.splitlines() if re.search(r'runtime.*未実装|未実装.*runtime',l)]})
print(json.dumps({'links':links,'fragments':fragments,'files':results},ensure_ascii=False,indent=2))
