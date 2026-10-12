"""Conservative ROI-to-CAD join. Never place furniture in an engagement strip.
Run from the repository root; no database or analytics changes.
"""
import json, math, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'frontend/public/flowfield'
layout = json.loads((PUBLIC / 'layout_prod.json').read_text())
pack = json.loads((PUBLIC / 'layers_pack.json').read_text())
categories = {'Frutta': 'produce', 'Verdura': 'produce', 'Latticini': 'dairy',
              'Surgelati': 'freezer', 'Carne': 'meat', 'Pesce': 'fish'}

def edges(p):
    return list(zip(p, p[1:] + p[:1]))

def distance(a,b):
    return math.hypot(a[0]-b[0],a[1]-b[1])

def rectangle(p):
    if len(p) != 4: return False
    a,b,c,d=p
    u=[b[i]-a[i] for i in (0,1)];v=[c[i]-b[i] for i in (0,1)]
    return abs(sum(u[i]*v[i] for i in (0,1))) < .02 and distance(a,c) > .5 and abs(distance(a,b)-distance(c,d))<.03 and abs(distance(b,c)-distance(d,a))<.03

def inside(x,z,p):
    yes=False
    for a,b in edges(p):
        if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:yes=not yes
    return yes

def inset_rectangle(p):
    # CAD vertex-grid search: every cell of the rectangle must be inside the
    # polygon. Inset by 7 cm, including the CAD's 6 cm chamfered corners.
    xs=sorted(set(v[0] for v in p));zs=sorted(set(v[1] for v in p));best=None
    for a in range(len(xs)-1):
        for b in range(a+1,len(xs)):
            for c in range(len(zs)-1):
                for d in range(c+1,len(zs)):
                    w=xs[b]-xs[a]-.14;h=zs[d]-zs[c]-.14
                    if w<1.8 or h<.3 or (best and w*h<=best[0]):continue
                    if all(inside((xs[i]+xs[i+1])/2,(zs[j]+zs[j+1])/2,p) for i in range(a,b) for j in range(c,d)):
                        best=(w*h,(xs[a]+xs[b])/2,(zs[c]+zs[d])/2,w,h)
    return best

mapped={}; unmatched=[]
for roi in pack['rois']:
    cat=roi.get('category')
    if cat not in categories: continue
    candidates=[]
    for idx,p in enumerate(layout['polys']):
        if not rectangle(p): continue
        for a,b in edges(p):
            if distance(a,b)<1.6: continue
            for c,d in edges(roi['vertices']):
                if min(max(distance(a,c),distance(b,d)),max(distance(a,d),distance(b,c))) < .035:
                    candidates.append(idx)
    candidates=sorted(set(candidates))
    if len(candidates)!=1:
        unmatched.append({'roi':roi['id'],'category':cat,'reason':'No unique CAD edge match','candidates':candidates});continue
    idx=candidates[0];p=layout['polys'][idx]
    if idx not in mapped:
        a,b=max(edges(p),key=lambda e:distance(*e))
        length=distance(a,b);width=min(distance(*e) for e in edges(p))
        mapped[idx]={'cadIndex':idx,'category':cat,'asset':categories[cat], 'shelfId':roi['shelf_id'],
                     'polygon':p,'x':sum(v[0] for v in p)/4,'z':sum(v[1] for v in p)/4,
                     'width':width,'length':length,'yaw':math.atan2(b[0]-a[0],b[1]-a[1]),'fronts':[]}
    # This is the shared edge, NOT the outer edge of the 1.5 m engagement band.
    for a,b in edges(p):
        for c,d in edges(roi['vertices']):
            if distance(a,b)>1.6 and min(max(distance(a,c),distance(b,d)),max(distance(a,d),distance(b,c)))<.035:
                mapped[idx]['fronts'].append([a,b])

# Checkout CAD outlines are notched, not rectangles. Keep that outline and fit
# the illustrative belt/scanner inside its largest proven interior rectangle.
for roi in pack['rois']:
    if not roi['name'].startswith('Checkout ') or not roi['name'].endswith(' - Service'):continue
    q=roi['vertices'];xmin=min(p[0] for p in q);xmax=max(p[0] for p in q);zmin=min(p[1] for p in q);zmax=max(p[1] for p in q)
    candidates=[]
    for idx,p in enumerate(layout['polys']):
        if len(p)<8 or idx in mapped:continue
        cx=(min(v[0] for v in p)+max(v[0] for v in p))/2;cz=(min(v[1] for v in p)+max(v[1] for v in p))/2
        if xmin<=cx<=xmax and zmin<=cz<=zmax:
            rect=inset_rectangle(p)
            if rect:candidates.append((-abs(cz-roi['cz']),idx,p,rect))
    if not candidates:continue
    _,idx,p,rect=max(candidates);_,x,z,length,width=rect;lane=int(roi['name'].split()[1])
    mapped[idx]={'cadIndex':idx,'category':f'Checkout {lane}','asset':'checkout','shelfId':None,'lane':lane,
                 'polygon':p,'x':x,'z':z,'width':width,'length':length,
                 'yaw':math.pi/2,'fronts':[],'retainCad':True,'tile':False}

out={'schema':'retail-fixtures-v1','venueId':layout['venue']['id'],
     'layoutSha256':hashlib.sha256((PUBLIC/'layout_prod.json').read_bytes()).hexdigest(),
     'frame':'venue metres: glTF (X,Y,Z) = Blender (X,Z,-Y); origin at fixture floor centre',
     'note':'CAD footprints and shelf-front edges are calibrated. Product assortments, heights and fixture styling are illustrative.',
     'fixtures':list(mapped.values()),'unmatched':unmatched,
     'assets':{k:{'url':f'./retail/{k}.glb','width':1.7,'length':2.6} for k in set(categories.values())|{'checkout'}}}
(PUBLIC/'retail/manifest.json').write_text(json.dumps(out,indent=2)+'\n')
print('Mapped:',{c:sum(x['category'].startswith('Checkout ') if c=='Checkout' else x['category']==c for x in mapped.values()) for c in [*categories,'Checkout']},'unmatched:',len(unmatched))
