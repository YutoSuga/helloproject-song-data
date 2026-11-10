export class CliArgumentError extends Error {}
const specs={
 'status':[], 'init':['check?','external-declaration','expect-audit-hash?'],
 'decision template':['candidate'], 'decision import':['input'], 'decision show':['$id'],
 'decision validate':['$id','revision'], 'decision confirm':['$id','revision','expect-head'],
 'plan create':['decision','revision','expect-decision-hash'], 'plan show':['$id'], 'plan check':['$id'],
 'apply':['plan','expect-plan-hash'], 'result':['request'], 'history show':['$id'],
 'recovery inspect':['request'], 'recovery run':['transaction','expect-state-hash','action']
};
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const patterns={decision:new RegExp(`^dec_${uuid}$`),plan:/^ap_[0-9a-f]{64}$/,request:new RegExp(`^${uuid}$`),transaction:new RegExp(`^tx_${uuid}$`)};
const actions=['abort','rollback','finalize_success','finish_terminal','cleanup'];
export const COMMANDS=Object.keys(specs);
export function parseCanonicalArguments(argv) {
 const fail=message=>{throw new CliArgumentError(message);};
 let json=false; const args=[];
 for(const arg of argv)if(arg==='--json'){if(json)fail('Duplicate --json');json=true;}else args.push(arg);
 if(args.length===1&&['help','--help'].includes(args[0]))return {command:'help',json,options:{}};
 const family=args.shift();let command=family;
 if(['decision','plan','history','recovery'].includes(family))command+=' '+args.shift();
 if(!Object.hasOwn(specs,command))fail('Unknown command; use help');
 const spec=specs[command];
 const options={};
 if(spec.includes('$id')) {options.id=args.shift();if(!options.id||options.id.startsWith('-'))fail('Missing ID');}
 while(args.length){
  const flag=args.shift();if(!flag.startsWith('--'))fail('Unexpected argument');
  const name=flag.slice(2),entry=spec.find(v=>v.replace('?','')===name);
  if(!entry||Object.hasOwn(options,name))fail('Unknown or duplicate option: '+flag);
  if(name==='check')options[name]=true;
  else {const value=args.shift();if(!value||value.startsWith('--'))fail('Missing option value: '+flag);options[name]=value;}
 }
 for(const name of spec)if(!name.endsWith('?')&&name!=='$id'&&!options[name])fail('Required --'+name);
 if(command==='init'&&(options.check?options['expect-audit-hash']!==undefined:!options['expect-audit-hash']))fail('Use --check OR --expect-audit-hash');
 for(const [key,value] of Object.entries(options)) {
  if(key.includes('hash')||key==='expect-head'){if(!/^[0-9a-f]{64}$/.test(value))fail('Invalid hash');}
  if(patterns[key]&&!patterns[key].test(value))fail('Invalid '+key+' ID');
  if(key==='revision'){if(!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value)))fail('Invalid revision');options[key]=Number(value);}
 }
 if(options.id){const pattern=command.startsWith('decision ')?patterns.decision:command.startsWith('plan ')?patterns.plan:new RegExp(`^apply_${uuid}$`);if(!pattern.test(options.id))fail('Invalid ID');}
 if(options.action&&!actions.includes(options.action))fail('Unknown Recovery action');
 return {command,options,json};
}
