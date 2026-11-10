"""Actual OS TTY driver for isolated CLI processes; never part of the CLI."""
import errno,json,os,pty,selectors,signal,subprocess,sys,time
request=json.loads(sys.argv[1])
master,slave=pty.openpty()
env=os.environ.copy()
for name in ['CI','GITHUB_ACTIONS']:
    env.pop(name,None)
env.update(request.get('env',{}))
process=subprocess.Popen(request['argv'],cwd=request['root'],stdin=slave,stderr=slave,stdout=subprocess.PIPE,env=env)
os.close(slave)
selector=selectors.DefaultSelector()
selector.register(master,selectors.EVENT_READ,'stderr')
selector.register(process.stdout,selectors.EVENT_READ,'stdout')
chunks={'stdout':b'','stderr':b''}
answered=False;killed=False;prompt_notified=False;started=time.monotonic()
try:
    while selector.get_map():
        if time.monotonic()-started>request.get('timeout',850):
            raise TimeoutError('Actual CLI process did not reach expected boundary/exit')
        for key,_ in selector.select(0.1):
            try:
                chunk=os.read(key.fd,65536)
            except OSError as error:
                if error.errno!=errno.EIO:raise
                chunk=b''
            if not chunk:
                selector.unregister(key.fileobj);continue
            chunks[key.data]+=chunk
        text=chunks['stderr'].decode('utf-8',errors='replace')
        if not answered and 'Continue? [y/N]' in text:
            answer_file=request.get('answer_file')
            if answer_file and not prompt_notified:
                print('TRUSTED_PROMPT',file=sys.stderr,flush=True);prompt_notified=True
            if not answer_file or os.path.exists(answer_file):
                answer=open(answer_file,encoding='utf-8').read() if answer_file else request.get('answer','n\n')
                os.write(master,answer.encode());answered=True
        if request.get('kill_boundary') and 'TRUSTED_TEST_BOUNDARY\n' in text.replace('\r\n','\n') and not killed:
            os.kill(process.pid,getattr(signal,request.get('stop_signal','SIGKILL')));killed=True
    result=process.wait(timeout=5)
    print(json.dumps({'code':result,'stdout':chunks['stdout'].decode(),'stderr':chunks['stderr'].decode(),'answered':answered,'killed':killed}))
finally:
    if process.poll() is None:
        process.kill();process.wait()
    os.close(master)
