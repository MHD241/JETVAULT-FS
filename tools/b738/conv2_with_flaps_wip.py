import json,struct,collections,sys,numpy as np
U='/root/.claude/uploads/6d0491ca-5ad0-5833-9ea8-60236238eee9/'
OUT='/home/user/JETVAULT-FS/public/models/b738_full.bin'
mats={};cur=None
for l in open(U+'2e3de071-PLANE.mtl'):
    t=l.split()
    if not t:continue
    if t[0]=='newmtl':cur=l.split(None,1)[1].strip();mats[cur]={}
    elif t[0]=='Kd':mats[cur]['kd']=list(map(float,t[1:4]))
    elif t[0]=='Ns':mats[cur]['ns']=float(t[1])
    elif t[0]=='d':mats[cur]['d']=float(t[1])
V=[];N=[];T=[]  # T: (material, [(vi,ni)x3])
cur=None
for l in open(U+'49185c51-PLANE.obj'):
    if l.startswith('v '):V.append(tuple(map(float,l.split()[1:4])))
    elif l.startswith('vn '):N.append(tuple(map(float,l.split()[1:4])))
    elif l.startswith('usemtl'):cur=l.split(None,1)[1].strip()
    elif l.startswith('f '):
        idx=[tuple(int(x) if x else 0 for x in (t.split('/')+['','',''])[0:3:2]) for t in l.split()[1:]]
        for i in range(1,len(idx)-1):T.append((cur,[idx[0],idx[i],idx[i+1]]))
V=np.array(V);N=np.array(N)
# drop stray bit far off the right wing
T=[t for t in T if max(V[a-1][0] for a,_ in t[1])<=25]
# ---- connected components (welded positions) to find the tailplane
key={};wid=np.zeros(len(V),int)
for i,v in enumerate(np.round(V,3)):wid[i]=key.setdefault(tuple(v),len(key))
par=list(range(len(key)))
def f(x):
    while par[x]!=x:par[x]=par[par[x]];x=par[x]
    return x
for m,tri in T:
    a,b,c=[wid[v-1] for v,_ in tri];ra=f(a);par[f(b)]=ra;par[f(c)]=ra
comp=collections.defaultdict(list)
for k,(m,tri) in enumerate(T):comp[f(wid[tri[0][0]-1])].append(k)
tail=[ts for ts in comp.values() if len(ts)==2100 and abs(min(V[a-1][0] for k in ts for a,_ in T[k][1])+7.6)<0.2][0]
tailset=set(tail)
TP=np.array([V[a-1] for k in tail for a,_ in T[k][1]])
XC=-0.36  # tailplane centre line (apex of the leading edge)
# chord edges per spanwise offset
# The skin is long root-to-tip triangles, so edges are fitted from the vertex clusters at s = 1.25 m (root) and 7.2 m (tip):
# leading edge z -20.42 -> -24.54, trailing edge z -23.91 -> -25.36, surface height y 4.80 -> 5.75
def lin(a0,a1):return np.array([(a1-a0)/(7.2-1.25),a0-(a1-a0)/(7.2-1.25)*1.25])
LE=lin(-20.42,-24.54);TE=lin(-23.91,-25.36);YS=lin(4.80,5.75)
H=0.66  # hinge at 66 % of the chord from the leading edge
pz=H*TE+(1-H)*LE;py=YS
S_IN,S_OUT=1.4,6.6   # elevator spans from 1.4 m to 6.6 m off the centre line
print('hinge z(s)=%.4f*s+%.3f  y(s)=%.4f*s+%.3f'%(pz[0],pz[1],py[0],py[1]))
# ---- ailerons: hinge along the model's engraved line, 0.25 m forward of it (user-approved); x = 10.2..15.6 m on the right wing, mirrored for the left
A_IN,A_OUT=10.5-XC,15.3-XC          # in |x - XC| terms
Ahinge=lambda xr:-8.10-0.328*(xr-10.29)+0.10
Ay=lambda xr:3.28+0.102*(xr-10.5)    # wing skin height at the hinge
# ---- rudder (user-approved from a side-view drawing): hinge 28 % of the chord forward of the trailing edge, y = 5.6..12.2 m
RUD_YB,RUD_YT,RUD_C=5.6,12.2,0.28
RTE=lambda y:-23.35-0.252*(y-5.75)
RLEB=lambda y:-17.7-0.93*(y-6.3)
rhzA=lambda y:(1-RUD_C)*RTE(y)+RUD_C*(-17.7)
rhzB=lambda y:(1-RUD_C)*RTE(y)+RUD_C*RLEB(y)   # hinge = min(rhzA, rhzB): two straight segments meeting at y = 6.3 m
# ---- flaps (user-approved drawing): right-wing absolute x; sections F1 root 1.65..4.9, F2 inboard 4.9..7.3, F3 outboard 7.3..10.15
FLAP_SEC=[('I',1.65,7.3),('O',7.3,10.15)]   # inboard flap (one piece, one hinge) and outboard flap
FRONT_FLAT=-6.05
FRONT_SLOPE=(-8.12+6.05)/(10.15-4.9)           # front edge: level to x = 4.9, then along the grey strip
PODS=[3.75,6.10,8.69]; POD_HW=0.28              # flap-track fairings stay fixed on the wing; the flaps get a clearance slot around each
_FYX=[1.65,2,3,4,5,6,7,8,9,10.15];_FYY=[2.40,2.42,2.54,2.75,2.85,2.95,3.05,3.13,3.21,3.34]   # the wing's real upper-skin height at the flap front edge (measured)
Fy=lambda xr:float(np.interp(xr,_FYX,_FYY))-0.03                  # flap top sits flush with it (3 cm under), not above the wing
_Z73=FRONT_FLAT+FRONT_SLOPE*(7.3-4.9)
_SLOPE_I=(_Z73-FRONT_FLAT)/(7.3-1.65)
FLAP_DEEPER=0.6                                  # flaps made chunkier: front edge 0.6 m forward of the original line, about a quarter of the wing chord
def front_fn(nm,x):
    return FLAP_DEEPER+(FRONT_FLAT+_SLOPE_I*(x-1.65) if nm=='I' else FRONT_FLAT+FRONT_SLOPE*(x-4.9))
# ---- clip helpers: vertices are (pos(3), nrm(3)) as numpy arrays of length 6
def lerp(a,b,t):return a+(b-a)*t
def split(poly,fn):
    """split a convex polygon by the plane fn(v)=0: returns (inside fn>=0, outside fn<0)"""
    ins=[];out=[]
    n=len(poly)
    for i in range(n):
        a,b=poly[i],poly[(i+1)%n];fa,fb=fn(a),fn(b)
        if fa>=0:ins.append(a)
        else:out.append(a)
        if (fa>=0)!=(fb>=0):
            t=fa/(fa-fb);p=lerp(a,b,t);ins.append(p);out.append(p)
    return ins,out
def planes(side):
    # side=+1 right (x>XC), -1 left. s = side*(x-XC)
    s=lambda v:side*(v[0]-XC)
    return [lambda v:s(v)-S_IN, lambda v:S_OUT-s(v), lambda v:(pz[0]*s(v)+pz[1])-v[2]]   # inboard cut, outboard cut, aft of the hinge line
def clip_convex(poly,fns):
    ins=list(poly);outs=[]
    for fn in fns:
        if len(ins)<3:return None,outs
        i2,o2=split(ins,fn)
        if len(o2)>=3:outs.append(o2)
        ins=i2
    return (ins if len(ins)>=3 else None),outs
def flap_planes(side,xa,xb,nm):
    sv=lambda v:side*(v[0]-XC)
    sa,sb=xa-XC,xb-XC
    return [lambda v:sv(v)-sa, lambda v:sb-sv(v), lambda v:front_fn(nm,XC+sv(v))-v[2]]
def slot_split(poly,side):
    """remove the clearance slots around the fixed pods from a flap piece: returns (flap polys, body polys)"""
    flap=[poly];body=[]
    for pod in PODS:
        lo,hi=pod-POD_HW,pod+POD_HW
        nf=[]
        for pp in flap:
            xr=lambda v:XC+side*(v[0]-XC)                    # right-wing absolute x of a point (mirror for the left wing)
            r_in,r_out=split(pp,lambda v:xr(v)-hi)           # right of the slot
            if len(r_in)>=3:nf.append(r_in)
            l_in,l_out=split(r_out,lambda v:lo-xr(v)) if len(r_out)>=3 else ([],[])
            if len(l_in)>=3:nf.append(l_in)
            if len(l_out)>=3:body.append(l_out)
        flap=nf
    return flap,body
def tris(poly):
    return [(poly[0],poly[i],poly[i+1]) for i in range(1,len(poly)-1)] if len(poly)>=3 else []
def aplanes(side):
    sv=lambda v:side*(v[0]-XC)
    return [lambda v:sv(v)-A_IN, lambda v:A_OUT-sv(v), lambda v:Ahinge(XC+sv(v))-v[2]]
def rplanes():
    return [lambda v:v[1]-RUD_YB, lambda v:RUD_YT-v[1], lambda v:rhzA(v[1])-v[2], lambda v:rhzB(v[1])-v[2]]
DROPPED=collections.defaultdict(list)   # vertices of the old flap-zone skin that is replaced by clean panels (used to cap the fixed wing)
parts={'podR1':collections.defaultdict(list),'podR2':collections.defaultdict(list),'podR3':collections.defaultdict(list),'podL1':collections.defaultdict(list),'podL2':collections.defaultdict(list),'podL3':collections.defaultdict(list),'flapRI':collections.defaultdict(list),'flapRO':collections.defaultdict(list),'flapLI':collections.defaultdict(list),'flapLO':collections.defaultdict(list),'rud':collections.defaultdict(list),'ailL':collections.defaultdict(list),'ailR':collections.defaultdict(list),'body':collections.defaultdict(list),'gearN':collections.defaultdict(list),'gearL':collections.defaultdict(list),'gearR':collections.defaultdict(list),'elevL':collections.defaultdict(list),'elevR':collections.defaultdict(list)}
def add(part,m,tri):parts[part][m].append(tri)
nsplit=0
def proc(verts,k,m,allow_flap):
    global nsplit
    ps=[v[:3] for v in verts];ys=[p[1] for p in ps];xs=[p[0] for p in ps];zs=[p[2] for p in ps]
    if k in tailset:
        done=False
        for part,side in (('elevR',1),('elevL',-1)):
            if (np.mean(xs)-XC)*side<0:continue
            poly=list(verts);outs=[]
            for fn in planes(side):
                if len(poly)<3:break
                ins,out=split(poly,fn);outs.append(out);poly=ins
            if len(poly)>=3:
                for t3 in tris(poly):add(part,m,t3)
            for out in outs:
                for t3 in tris(out):add('body',m,t3)
            if any(len(o)>=3 for o in outs) and len(poly)>=3:nsplit+=1
            done=True;break
        if done:return
    cx=np.mean(xs)
    if k not in tailset and abs(cx-XC)<0.9 and 5.4<np.mean(ys)<12.4 and -25.6<np.mean(zs)<-20:
        poly=list(verts);outs=[]
        for fn in rplanes():
            if len(poly)<3:break
            ins,out=split(poly,fn);outs.append(out);poly=ins
        if len(poly)>=3:
            for t3 in tris(poly):add('rud',m,t3)
        for out in outs:
            for t3 in tris(out):add('body',m,t3)
        return
    sc=abs(cx-XC) if False else abs(np.mean(xs)-XC)
    if allow_flap and 2.45<np.mean(ys)<4.3 and -9.7<np.mean(zs)<-5.5 and FLAP_SEC[0][1]-XC-0.6<=sc<=FLAP_SEC[-1][2]-XC+0.6:
        side=1 if np.mean(xs)>XC else -1
        pieces=[list(verts)]
        for nm,xa,xb in FLAP_SEC:
            nxt=[]
            for pc in pieces:
                ins,outs=clip_convex(pc,flap_planes(side,xa,xb,nm))
                if ins:
                    fl,bd=slot_split(ins,side)
                    FLAP_MATS=('wing1.001','wing1.002','0132_LightGray.001')      # the old trailing-edge skin and strip, which is replaced by clean flap panels
                    for q in fl:
                        if np.mean([v[1] for v in q])<3.35:
                            DROPPED[(side,nm)].extend([tuple(v[:3]) for v in q])     # removed (any material, incl. thin trim lines): a clean panel takes its place
                        else:
                            for t3 in tris(q):add('body',m,t3)
                    for q in bd:
                        xc_=np.mean([XC+side*(v[0]-XC) for v in q]);yc_=np.mean([v[1] for v in q])
                        pi=int(np.argmin([abs(xc_-pd) for pd in PODS]))
                        if yc_<Fy(xc_)-0.14:      # below mid-thickness = the fairing (canoe) and the lower skin in its column: stays as the pod
                            for t3 in tris(q):add('pod%s%d'%('R' if side==1 else 'L',pi+1),m,t3)
                        elif yc_<3.35:
                            DROPPED[(side,nm)].extend([tuple(v[:3]) for v in q])
                        else:
                            for t3 in tris(q):add('body',m,t3)
                nxt+=outs
            pieces=nxt
        for q in pieces:
            for t3 in tris(q):proc(list(t3),k,m,False)   # leftovers still get the aileron / body tests
        return
    if 2.6<np.mean(ys)<4.3 and -11.5<np.mean(zs)<-7.0 and (9.6<=abs(cx-XC)-0+0.0<=17.0 or True) and A_IN-0.5<=abs(cx-XC)<=A_OUT+0.5:
        side=1 if cx>XC else -1; part='ailR' if side==1 else 'ailL'
        poly=list(verts);outs=[]
        for fn in aplanes(side):
            if len(poly)<3:break
            ins,out=split(poly,fn);outs.append(out);poly=ins
        if len(poly)>=3:
            for t3 in tris(poly):add(part,m,t3)
            for out in outs:
                for t3 in tris(out):add('body',m,t3)
            return
        elif any(len(o)>=3 for o in outs):
            for out in outs:
                for t3 in tris(out):add('body',m,t3)
            return
    gear=max(ys)<1.25 and ((abs(sum(zs)/3+5)<2.6 and abs(sum(xs)/3-.15)<3.5) or (abs(sum(xs)/3)<1.2 and sum(zs)/3>8))
    part='body'
    if gear:part='gearN' if abs(sum(xs)/3)<1.2 and sum(zs)/3>8 else ('gearL' if sum(xs)/3>.15 else 'gearR')
    add(part,m,tuple(verts))
for k,(m,tri) in enumerate(T):
    proc([np.concatenate([V[a-1],N[b-1] if b else np.array([0,1,0.])]) for a,b in tri],k,m,True)
print('triangles split along cuts:',nsplit,{p:sum(len(v) for v in d.values()) for p,d in parts.items()})

# ---- close the open cut edges: the wing trailing edge is a hollow shell (upper + lower skin), so every cut edge of a flap section
# would show the inside. Build a thin end-cap between the two skins along each cut line, once for the flap piece and once for
# the fixed wing, so nothing looks open at any flap angle.
def cap_strips(pts,paramidx):
    """pts: list of (x,y,z) on one cut line; groups by position along the line, spans top and bottom skin"""
    bins={}
    for p in pts:
        b=round(p[paramidx]/0.12)
        bins.setdefault(b,[]).append(p)
    cols=[]
    for b in sorted(bins):
        q=bins[b];top=max(q,key=lambda v:v[1]);bot=min(q,key=lambda v:v[1])
        if top[1]-bot[1]>0.03:cols.append((top,bot))
    out=[]
    for (t0,b0),(t1,b1) in zip(cols,cols[1:]):
        if abs(t0[paramidx]-t1[paramidx])>0.5:continue
        out.append((t0,b0,t1));out.append((b0,b1,t1))
    return out
ncap=0
for side in (1,-1):
    for nm,xa,xb in FLAP_SEC:
        pts=DROPPED[(side,nm)]
        if not pts:continue
        xr=lambda p:XC+side*(p[0]-XC)
        groups=[]
        def pick(cond,par):
            g=[p for p in pts if cond(p)]
            if g:groups.append((g,par))
        front=lambda p,nm=nm:front_fn(nm,xr(p))
        pick(lambda p:abs(p[2]-front(p))<2e-3,0)                          # the fixed wing's cut front edge (param = x)
        if nm=='I':pick(lambda p:abs(xr(p)-xa)<2e-3,2)                    # root end next to the fuselage
        if nm=='O':pick(lambda p:abs(xr(p)-xb)<2e-3,2)                    # outer end next to the aileron
        for g,par in groups:
            for t3 in cap_strips(g,par):
                nrm=np.cross(np.array(t3[1])-np.array(t3[0]),np.array(t3[2])-np.array(t3[0]));l=np.linalg.norm(nrm)
                if l<1e-9:continue
                tri3=tuple(np.concatenate([np.array(v),nrm/l]) for v in t3)
                parts['body']['wing1.001'].append(tri3);ncap+=1
print('end-cap triangles added:',ncap)

# ---- clean flap panels: the old trailing-edge skin in the flap zone was removed above; each flap is rebuilt as a simple closed
# panel with the same plan outline (front edge, trailing edge taken from the wing's real trailing edge, section ends), a thin
# wedge cross-section, closed front edge, trailing edge and ends.
def build_te():
    bins=np.arange(1.2,10.8,0.2);zmin=np.full(len(bins),np.nan)
    for m,tri in T:
        if m not in ('wing1.001','wing1.002','0132_LightGray.001'):continue
        for a,_ in tri:
            v=V[a-1]
            if not (2.4<v[1]<3.4 and 1.2<=v[0]<10.8):continue
            if any(abs(v[0]-pd)<POD_HW+0.2 for pd in PODS):continue
            i=int((v[0]-1.2)/0.2)
            if np.isnan(zmin[i]) or v[2]<zmin[i]:zmin[i]=v[2]
    ok=~np.isnan(zmin);zf=np.interp(bins,bins[ok],zmin[ok])
    zs_=np.convolve(np.pad(zf,2,mode='edge'),np.ones(5)/5,mode='valid')
    return bins+0.1,zs_
TE_X,TE_Z=build_te()
# the wing's trailing edge, measured earlier from the wing outline (and shown to the user in the flap drawings)
TEz=lambda x:(-6.55-0.123*(x-1.65)) if x<=4.9 else (-6.95-0.32*(x-4.9))
for _x in (1.8,3,4.9,6,7.3,8.5,10):print('flap depth at x=%.1f: front %.2f  trailing edge %.2f  depth %.2f m'%(_x,front_fn('I' if _x<7.3 else 'O',_x),TEz(_x),front_fn('I' if _x<7.3 else 'O',_x)-TEz(_x)))
def quad(node,p0,p1,p2,p3,ref):
    for tri in ((p0,p1,p2),(p0,p2,p3)):
        nrm=np.cross(tri[1]-tri[0],tri[2]-tri[0]);l=np.linalg.norm(nrm)
        if l<1e-9:continue
        nrm=nrm/l
        if np.dot(nrm,ref)<0:nrm=-nrm
        if np.dot(np.cross(tri[1]-tri[0],tri[2]-tri[0]),nrm)<0:tri=(tri[0],tri[2],tri[1])   # winding agrees with the normal (the mirrored wing was shaded as a back face)
        parts[node]['wing1.001'].append(tuple(np.concatenate([v,nrm]) for v in tri))
npan=0
for side in (1,-1):
    mx=(lambda x:x) if side==1 else (lambda x:2*XC-x)
    for nm,xa,xb in FLAP_SEC:
        node='flap%s%s'%('R' if side==1 else 'L',nm)
        n=max(2,int(round((xb-xa)/0.12)));xs=np.linspace(xa,xb,n+1)
        def P(x,yo,z,s):return np.array([mx(x),Fy(x)+yo(s),z])
        top=lambda s:-0.05*s;bot=lambda s:-0.18+0.12*s        # wedge: 0.18 m thick at the hinge, closing to the trailing edge
        for i in range(n):
            x0,x1=xs[i],xs[i+1]
            zf0,zf1=front_fn(nm,x0),front_fn(nm,x1);zt0,zt1=min(TEz(x0),zf0-0.2),min(TEz(x1),zf1-0.2)
            At,Bt,Ct,Dt=P(x0,top,zf0,0),P(x1,top,zf1,0),P(x1,top,zt1,1),P(x0,top,zt0,1)
            Ab,Bb,Cb,Db=P(x0,bot,zf0,0),P(x1,bot,zf1,0),P(x1,bot,zt1,1),P(x0,bot,zt0,1)
            quad(node,At,Bt,Ct,Dt,np.array([0,1,0.]))            # upper surface
            quad(node,Ab,Bb,Cb,Db,np.array([0,-1,0.]))           # lower surface
            quad(node,At,Bt,Bb,Ab,np.array([0,0,1.]))            # closed front edge
            quad(node,Dt,Ct,Cb,Db,np.array([0,0,-1.]))           # trailing edge
            npan+=4
        for x,sgn in ((xa,-1),(xb,1)):                           # closed ends
            zf,zt=front_fn(nm,x),min(TEz(x),front_fn(nm,x)-0.2)
            quad(node,P(x,top,zf,0),P(x,top,zt,1),P(x,bot,zt,1),P(x,bot,zf,0),np.array([sgn*side,0,0.]));npan+=2
print('clean flap panel quads added:',npan)

for side in (1,-1):
    for k_,pod in enumerate(PODS):
        node='pod%s%d'%('R' if side==1 else 'L',k_+1)
        pts=[v[:3] for m,tl in parts[node].items() for t3 in tl for v in t3]
        if not pts:continue
        xr=lambda p:XC+side*(p[0]-XC)
        # the pod's front end is the cut at the flap front edge (inboard or outboard flap line); cap it like the flaps
        nm='I' if pod<7.3 else 'O'
        g=[p for p in pts if abs(p[2]-front_fn(nm,xr(p)))<2e-3]
        for t3 in cap_strips(g,0):
            nrm=np.cross(np.array(t3[1])-np.array(t3[0]),np.array(t3[2])-np.array(t3[0]));l=np.linalg.norm(nrm)
            if l<1e-9:continue
            tri3=tuple(np.concatenate([np.array(v),nrm/l]) for v in t3)
            parts[node]['wing1.001'].append(tri3);parts['body']['wing1.001'].append(tri3)



# ---- telescoping pods (user request: the pods should SLIDE out, not just move): the moving rear part gets a slightly narrower
# inner "tube" copied from the fixed pod just in front of the cut; at rest it is hidden inside the fixed pod, and as the pod
# slides aft it slides out of the fixed part, so no seam ever opens.
TUBE_LEN=0.75;TUBE_K=0.8
POD_PIVOT={}
ntube=0
for side in (1,-1):
    for k_,pod in enumerate(PODS):
        node='pod%s%d'%('R' if side==1 else 'L',k_+1)
        nm='I' if pod<7.3 else 'O'
        src=[]
        for kk,(m,tri) in enumerate(T):
            vv=[np.concatenate([V[a-1],N[b-1] if b else np.array([0,1,0.])]) for a,b in tri]
            xs_=[XC+side*(v[0]-XC) for v in vv]
            if not all(abs(x-pod)<POD_HW+0.1 for x in xs_):continue
            if (np.mean([v[0] for v in vv])-XC)*side<=0:continue
            xc_=np.mean(xs_);yc_=np.mean([v[1] for v in vv]);zc_=np.mean([v[2] for v in vv])
            f_=front_fn(nm,xc_)
            if yc_<Fy(xc_)-0.14 and f_<zc_<f_+TUBE_LEN:src.append((m,vv))
        if not src:continue
        ym=np.mean([v[1] for m,vv in src for v in vv])
        POD_PIVOT[node]=[float(XC+side*(pod-XC)),float(ym),float(front_fn(nm,pod)+TUBE_LEN)]   # tilt about the FRONT END of the inner tube, so no part of it swings out of the fixed pod
        for m,vv in src:
            nv=[]
            for v in vv:
                xr_=XC+side*(v[0]-XC);xr2=pod+(xr_-pod)*TUBE_K;x2=XC+side*(xr2-XC)
                nv.append(np.concatenate([[x2,ym+(v[1]-ym)*TUBE_K,v[2]],v[3:]]))
            parts[node][m].append(tuple(nv));ntube+=1
print('telescoping pod tube triangles added:',ntube)

# ---- write glb
bin=bytearray();bv=[];ac=[];meshes=[];nodes=[];mlist=[];mi={}
def push(arr,tgt):
    while len(bin)%4:bin.append(0)
    bv.append({'buffer':0,'byteOffset':len(bin),'byteLength':arr.nbytes,'target':tgt});bin.extend(arr.tobytes());return len(bv)-1
extras={}
for side,part in ((1,'elevR'),(-1,'elevL')):
    p0s,p1s=[side*S_IN,0,0],[side*S_OUT,0,0]
    pts=[]
    for s in (S_IN,S_OUT):
        x=XC+side*s;pts.append([x,float(np.polyval(py,s)),float(np.polyval(pz,s))])
    extras[part]={'hinge':pts}
for side,part in ((1,'ailR'),(-1,'ailL')):
    pts=[[XC+side*sv,float(Ay(XC+sv)),float(Ahinge(XC+sv))] for sv in (A_IN,A_OUT)]
    extras[part]={'hinge':pts}
for side in (1,-1):
    mx=(lambda x:x) if side==1 else (lambda x:2*XC-x)
    for nm,xa,xb in FLAP_SEC:
        pts=[(xa,front_fn(nm,xa)),(xb,front_fn(nm,xb))]
        extras['flap%s%s'%('R' if side==1 else 'L',nm)]={'hinge':[[mx(x),Fy(x),z] for x,z in pts]}
for _n,_pv in POD_PIVOT.items():extras[_n]={'pivot':_pv}
extras['rud']={'hinge':[[XC,6.3,float(rhzB(6.3))],[XC,RUD_YT,float(rhzB(RUD_YT))]]}
for part in ('body','gearN','gearL','gearR','elevL','elevR','ailL','ailR','rud','flapRI','flapRO','flapLI','flapLO','podR1','podR2','podR3','podL1','podL2','podL3'):
    prims=[]
    for m,tl in parts[part].items():
        keymap={};pos=[];nor=[];ind=[]
        for t3 in tl:
            for v in t3:
                kk=tuple(np.round(v,5))
                if kk not in keymap:
                    keymap[kk]=len(pos);pos.append(v[:3]);n=v[3:];l=np.linalg.norm(n);nor.append(n/l if l>1e-9 else np.array([0,1,0.]))
                ind.append(keymap[kk])
        P=np.array(pos,np.float32);Nn=np.array(nor,np.float32);I=np.array(ind,np.uint32)
        a0=len(ac);ac.append({'bufferView':push(P,34962),'componentType':5126,'count':len(P),'type':'VEC3','min':P.min(0).tolist(),'max':P.max(0).tolist()})
        ac.append({'bufferView':push(Nn,34962),'componentType':5126,'count':len(P),'type':'VEC3'})
        ac.append({'bufferView':push(I,34963),'componentType':5125,'count':len(I),'type':'SCALAR'})
        if m not in mi:
            d=mats.get(m,{});kd=d.get('kd',[.8,.8,.8]);al=d.get('d',1.0)
            mi[m]=len(mlist);mlist.append({'name':m,'pbrMetallicRoughness':{'baseColorFactor':kd+[al],'metallicFactor':0.0,'roughnessFactor':round(max(.05,1-(d.get('ns',144)/1000)**.5),2)},'alphaMode':'BLEND' if al<.99 else 'OPAQUE','doubleSided':True})
        prims.append({'attributes':{'POSITION':a0,'NORMAL':a0+1},'indices':a0+2,'material':mi[m]})
    meshes.append({'name':part,'primitives':prims});nd={'name':part,'mesh':len(meshes)-1}
    if part in extras:nd['extras']=extras[part]
    nodes.append(nd)
j={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':list(range(len(nodes)))}],'nodes':nodes,'meshes':meshes,'materials':mlist,'accessors':ac,'bufferViews':bv,'buffers':[{'byteLength':len(bin)}]}
js=json.dumps(j).encode();js+=b' '*(-len(js)%4)
while len(bin)%4:bin.append(0)
out=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bin))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bin),0x004E4942)+bytes(bin)
open(OUT,'wb').write(out);print(len(out)/1e6,'MB')

# ---- picture of the cut (top view): body skin grey, elevators red, hinge line dark
from PIL import Image, ImageDraw
W,Hh=1800,760; X0,X1,Z0,Z1=-8.5,8.5,-26.0,-19.0
im=Image.new('RGB',(W,Hh),'white'); d=ImageDraw.Draw(im)
px=lambda x:(x-X0)/(X1-X0)*W; pzz=lambda z:Hh-(z-Z0)/(Z1-Z0)*Hh*-1-Hh*0
def pzp(z):return (Z1-z)/(Z1-Z0)*Hh*-1+Hh
for gx in range(-8,9):
    d.line([(px(gx),0),(px(gx),Hh)],fill=(215,215,215)); d.text((px(gx)+3,3),str(gx),fill=(0,0,0))
for gz in range(-26,-18):
    d.line([(0,pzp(gz)),(W,pzp(gz))],fill=(215,215,215)); d.text((3,pzp(gz)+2),'z=%d'%gz,fill=(0,0,0))
for k in tail:
    pass
def draw_tri(t3,fill,out):
    d.polygon([(px(v[0]),pzp(v[2])) for v in t3],fill=fill,outline=out)
for m,tl in parts['body'].items():
    for t3 in tl:
        if all(-26<=v[2]<=-19 and abs(v[0]-XC)<7.6 and v[1]>4.3 and v[1]<6 for v in t3):draw_tri(t3,(230,234,240),(190,198,210))
for part in ('elevL','elevR'):
    for m,tl in parts[part].items():
        for t3 in tl:draw_tri(t3,(235,70,70),(150,20,20))
for side in (1,-1):
    a=(XC+side*S_IN,np.polyval(pz,S_IN));b=(XC+side*S_OUT,np.polyval(pz,S_OUT))
    d.line([(px(a[0]),pzp(a[1])),(px(b[0]),pzp(b[1]))],fill=(0,0,0),width=4)
d.text((20,Hh-34),'RED = elevators (what will move).  Black line = hinge (they swing about it).  Tailplane seen from above, x = span (m), z = length (m), nose toward the bottom.',fill=(0,0,0))
d.text((20,Hh-18),'Hinge sits at 66%% of the chord; spans x = %.1f..%.1f (left) and %.1f..%.1f (right).'%(XC-S_OUT,XC-S_IN,XC+S_IN,XC+S_OUT),fill=(0,0,0))
im.save('/tmp/claude-0/-home-user-JETVAULT-FS/6d0491ca-5ad0-5833-9ea8-60236238eee9/scratchpad/elev_cut.png')
