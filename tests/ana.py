"""Checks the results of run.py: 'One moment' before every save, no banned phrases, exactly one save_lead call,
the saved phone number matches the caller ID digit by digit, the number is read back correctly, and the call ends.
Usage: python tests/ana.py out.json tests/scenarios_sample.json"""
import json,re,sys
d=json.load(open(sys.argv[1])); scs={x["id"]:x for x in json.load(open(sys.argv[2]))}
BAN=["le agendé","ya tiene cita","queda reservad","está confirmada","cuenta como urgente","es urgente","booked you","counts as urgent","is urgent","you're booked","you're all set","booking with us","got it","trouble send","counts as urgent","repeating","appointment is confirmed","congratulations"]
for sid,log in d.items():
    issues=[]
    # split the log into caller turns
    turns=[];cur=[]
    for w,t in log:
        if w=="CALLER": turns.append(cur);cur=[(w,t)]
        else: cur.append((w,t))
    turns.append(cur)
    saves=[]
    for tn in turns:
        tools=[t for w,t in tn if w=="TOOL" and "save_lead" in t]
        if tools:
            says=" ".join(t for w,t in tn if w=="MAYA")
            if not says.strip().startswith(("One moment","Un momento")): issues.append("no 'One moment' before save: "+says[:80])
            for t in tools:
                m=re.search(r'"arguments": (\{.*?\})',t); 
                if m: saves.append(json.loads(m.group(1)))
        for w,t in tn:
            if w=="TOOLRES" and "failed" in t: issues.append("save failed")
    for w,t in log:
        if w=="MAYA":
            for b in BAN:
                if b in t.lower(): issues.append(f"banned '{b}': {t[:90]}")
    if len(saves)>1: issues.append(f"{len(saves)} save_lead calls")
    for a in saves:
        ph=re.sub(r"\D","",str(a.get("phone","")))
        exp=scs[sid].get("expect")
        if ph!=(exp or ""): issues.append(f"PHONE WRONG: sent {ph} expected {exp}")
    W=("cero uno dos tres cuatro cinco seis siete ocho nueve" if scs[sid].get("es") else "zero one two three four five six seven eight nine").split()
    exp=scs[sid].get("expect")
    if exp:
        spoken=" ".join(W[int(c)] for c in exp)
        for w,t in log:
            if w=="MAYA":
                seq=re.findall(r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b",t.lower())
                if len(seq)>=7 and " ".join(seq)[-len(spoken):]!=spoken and spoken not in " ".join(seq): issues.append("READBACK WRONG: "+" ".join(seq))
    if scs[sid].get("expect") is None and saves: issues.append("saved without number")
    ended=any(w=="END" for w,t in log)
    if not ended: issues.append("no END")
    sv=" | ".join(f'{a.get("name")}/{a.get("phone")}/{a.get("patient_type")}/{a.get("service")}/{a.get("date")}/{a.get("status")}' for a in saves)
    print(f"{sid:7} {'OK ' if not issues else 'ISS'} saves={len(saves)} {sv[:160]}")
    for i in issues: print("        -",i)
