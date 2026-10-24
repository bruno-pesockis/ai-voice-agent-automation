"""Runs scripted test calls against a Voiceflow voice agent through the Dialog API.
Usage: python tests/run.py tests/scenarios_sample.json out.json
Each scenario plays a caller; when the script runs out, a simple rule-based caller answers Maya's questions."""
import urllib.parse, json, sys, time, uuid, urllib.request
import os
# Voiceflow Dialog API key: set the VOICEFLOW_API_KEY environment variable. Never commit the key.
KEY=os.environ.get("VOICEFLOW_API_KEY","").strip()
if not KEY: sys.exit("Set the VOICEFLOW_API_KEY environment variable first.")
URL="https://general-runtime.voiceflow.com/state/user/{}/interact"
def call(uid, action):
    req=urllib.request.Request(URL.format(urllib.parse.quote(uid,safe="")), data=json.dumps({"action":action,"config":{"tts":False,"stripSSML":True,"excludeTypes":["block","flow","path"]}}).encode(),
        headers={"Authorization":KEY,"Content-Type":"application/json","versionID":"production"},method="POST")
    for i in range(3):
        try:
            with urllib.request.urlopen(req,timeout=60) as r: return json.loads(r.read())
        except Exception as e:
            err=e; time.sleep(3)
    return [{"type":"error","payload":str(err)}]
def run(sc):
    uid=sc.get("uid") or "t-"+uuid.uuid4().hex[:10]
    log=[]; ended=False
    tr=call(uid,{"type":"launch"})
    def absorb(tr):
        nonlocal ended
        msgs=[]
        for t in tr:
            ty=t["type"]
            if ty in("text","speak"):
                m=t["payload"].get("message",""); msgs.append(m); log.append(("MAYA",m))
            elif ty=="end": ended=True; log.append(("END",""))
            elif ty=="debug":
                msg=t["payload"].get("message","")
                if "calling" in msg and "tool" in msg and "lookup" not in msg and "greeting" not in msg.lower():
                    md=t["payload"].get("metadata",{})
                    log.append(("TOOL",msg+" "+json.dumps(md)[:700]))
                elif ("api-tool" in json.dumps(t["payload"].get("ref",{})) and "lookup" not in json.dumps(t["payload"].get("ref",{}))):
                    log.append(("TOOLRES",msg[:200]))
            elif ty in("no-reply","path","flow","block"): pass
            else: log.append(("TRACE",ty+" "+json.dumps(t.get("payload"))[:600]))
        return " ".join(msgs)
    last=absorb(tr)
    script=list(sc.get("script",[])); p=json.loads(json.dumps(sc.get("p",{})))
    for turn in range(sc.get("max",14)):
        if ended: break
        if script: u=script.pop(0)
        else: u=(respond_es if sc.get('es') else respond)(last.lower(),p)
        if u is None: break
        log.append(("CALLER",u))
        last=absorb(call(uid,{"type":"text","payload":u}))
    return log
def respond(m,p0):
    class P(dict):
        def get(self,k,d=None):
            v=dict.get(self,k,d)
            if isinstance(v,list): return v.pop(0) if len(v)>1 else v[0]
            return v
    p=p0 if isinstance(p0,P) else P(p0)
    def has(*w): return any(x in m for x in w)
    if has("anything else","else i can help","is there anything"): return p.get("bye","No, that's all. Thanks.")
    if has("calling from"): return p.get("callfrom","Yes.")
    if has("is that right","is that correct","did i get","correct?","right?","confirm"): return p.get("yes","Yes, that's right.")
    if has("spell"): return p.get("spell","S-A-R-A-H  M-I-L-L-E-R.")
    if has("your name","who am i speaking","may i have your name","name?","the name","full name","first and last"): return p.get("name","Sarah Miller.")
    if has("number","phone","reach you","call you back on"): return p.get("phone","It's 813 555 0187.")
    if has("new patient","been to","seen us","been in","existing","before?","visited"): return p.get("new","I'm a new patient.")
    if has("insurance"): return p.get("ins","I have Delta Dental.")
    if has("date of birth","birthday"): return p.get("dob","March 3rd, 1985.")
    if has("which day","what day","day or time","day works","day suits","best time","what time","when would","morning or","afternoon","prefer","day would"): return p.get("time","Monday morning, please.")
    if has("swelling","pain","scale","how bad","bleeding","fever"): return p.get("sym","It's pretty bad but I can breathe fine.")
    if has("what's going on","reason","how can i help","what can i","help you","tell me"): return p.get("reason","I'd like to book a cleaning.")
    return p.get("other","Okay.")

def respond_es(m,p0):
    class P(dict):
        def get(self,k,d=None):
            v=dict.get(self,k,d)
            if isinstance(v,list): return v.pop(0) if len(v)>1 else v[0]
            return v
    p=P(p0)
    def has(*w): return any(x in m for x in w)
    if has("algo más","algo mas","otra cosa"): return p.get("bye","No, eso es todo. Gracias.")
    if has("desde el que","desde el cual","del que llama","que llama"): return p.get("callfrom","Sí.")
    if has("es correcto","está bien","esta bien","correcto?","¿es así","verdad?","confirmar"): return p.get("yes","Sí, es correcto.")
    if has("deletre"): return p.get("spell","M-I-L-L-E-R.")
    if has("nombre"): return p.get("name","Sara Miller.")
    if has("número","numero","teléfono","telefono","contactar","comunicarnos"): return p.get("phone","Sí, el número desde el que llamo.")
    if has("antes","primera vez","primera visita","paciente nuev","ya es paciente"): return p.get("new","Soy paciente nueva.")
    if has("seguro"): return p.get("ins","Tengo Delta Dental.")
    if has("qué día","que dia","qué hora","que hora","cuándo","cuando le","le conviene","prefiere","día u hora","dia u hora"): return p.get("time","El lunes por la mañana, por favor.")
    if has("hinchaz","dolor","sangr","fiebre"): return p.get("sym","Me duele bastante pero respiro bien.")
    if has("qué le pasa","qué está pasando","qué sucede","de qué se trata","sobre qué","motivo","en qué le puedo","cómo le puedo"): return p.get("reason","Quiero hacer una cita para una limpieza.")
    return p.get("other","Está bien.")

if __name__=="__main__":
    from concurrent.futures import ThreadPoolExecutor
    scs=json.load(open(sys.argv[1]))
    par=[x for x in scs if not x.get("seq")]; seq=[x for x in scs if x.get("seq")]
    with ThreadPoolExecutor(6) as ex: r1=dict(zip([x["id"] for x in par],ex.map(run,par)))
    for x in seq: r1[x["id"]]=run(x)
    res=[r1[x["id"]] for x in scs]
    out={}
    for sc,log in zip(scs,res):
        out[sc["id"]]=log
        print("=== "+sc["id"]+" — "+sc["title"])
        for who,t in log: print(f"{who}: {t}")
        print()
    json.dump(out,open(sys.argv[2],"w"),indent=1)
