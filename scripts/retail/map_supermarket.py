"""Join the exported object inventory to the CURRENT calibrated CAD, with fail-closed identity.
No database writes. No new analytical areas. Run from any working directory.
"""
import csv, json, math, hashlib, collections, runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'frontend/public/flowfield'
SOURCE=ROOT/'exports/treviglio_2026-08-11'
config=json.loads((ROOT/'retail/config/departments.json').read_text())
layout=json.loads((PUBLIC/'layout_prod.json').read_text())
pack=json.loads((PUBLIC/'layers_pack.json').read_text())
areas=json.loads((PUBLIC/'visitor-areas.json').read_text())
baseline=json.loads((ROOT/'retail/baselines/frutta-v1/frontend/public/flowfield/retail/manifest.json').read_text())
rows=list(csv.DictReader((SOURCE/'02_shelves_fixtures.csv').open()))
footprints=collections.defaultdict(list)
for r in csv.DictReader((SOURCE/'03_shelf_footprints.csv').open()):footprints[r['object_id']].append([float(r['x']),float(r['z'])])
def edges(p):return list(zip(p,p[1:]+p[:1]))
def inside(x,z,p):
    result=False
    for a,b in edges(p):
        if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:result=not result
    return result
def source_polygon(r):
    p=footprints[r['object_id']][:]
    px,pz,ry,sx,sz=[float(r[k])for k in ['pos_x','pos_z','rot_y','scale_x','scale_z']]
    if not p:p=[[px+dx*math.cos(ry)-dz*math.sin(ry),pz+dx*math.sin(ry)+dz*math.cos(ry)]for dx,dz in [(-sx/2,-sz/2),(sx/2,-sz/2),(sx/2,sz/2),(-sx/2,sz/2)]]
    if math.dist(p[0],p[-1])<1e-6:p.pop()
    return [[round(x,2),round(z,2)]for x,z in p]
assert len(rows)==len(layout['polys'])
for i,r in enumerate(rows):assert source_polygon(r)==layout['polys'][i],f'Stale source inventory at CAD {i}; reconcile before placing assets'
def fit(p):
    """Oriented rectangle for rectangular CAD; conservative interior rectangle otherwise."""
    a,b=max(edges(p),key=lambda e:math.dist(*e));length=math.dist(a,b)
    if len(p)==4:
        widths=sorted(math.dist(*e)for e in edges(p));width=widths[0]
        u=[b[k]-a[k]for k in (0,1)];c=p[(p.index(b)+1)%4];v=[c[k]-b[k]for k in (0,1)]
        if abs(sum(u[k]*v[k]for k in (0,1)))<.025:
            return sum(v[0]for v in p)/4,sum(v[1]for v in p)/4,width,length,math.atan2(u[0],u[1])
    # A small, fully interior box for irregular endcaps/tables. Never fill CAD cut-outs.
    xmin,xmax=min(v[0]for v in p),max(v[0]for v in p);zmin,zmax=min(v[1]for v in p),max(v[1]for v in p)
    x,z=(xmin+xmax)/2,(zmin+zmax)/2;w,h=xmax-xmin,zmax-zmin
    for scale in [.92,.84,.72,.60,.48,.36]:
        if all(inside(x+(i/16-.5)*w*scale,z+(j/16-.5)*h*scale,p)for i in range(17)for j in range(17)):
            return (x,z,h*scale,w*scale,math.pi/2)if w>h else(x,z,w*scale,h*scale,0)
    return None
roi_by_shelf=collections.defaultdict(list)
for r in pack['rois']:
    if r.get('shelf_id'):roi_by_shelf[r['shelf_id']].append(r)
fixtures=[];inventory=[];excluded=[]
old={f['cadIndex']:f for f in baseline['fixtures']}
for i,r in enumerate(rows):
    typ=r['type'];p=layout['polys'][i];rs=roi_by_shelf[r['object_id']]
    cats={q['category']for q in rs if q.get('category')}
    cat=next(iter(cats))if len(cats)==1 else r['business_category']
    if typ=='custom':continue
    record={'cadIndex':i,'objectId':r['object_id'],'sourceName':r['name'],'type':typ,'configuredCategory':cat or None,'sourceHeight':float(r['scale_y'])}
    if i in old and old[i]['category']=='Frutta':f=dict(old[i]);f.update(record);f['camera']='produce';fixtures.append(f);continue
    if typ=='checkout':
        if i not in old:excluded.append({**record,'reason':'Checkout has no matched lane ROI'});continue
        f=dict(old[i]);f.update(record);f['camera']='checkout';fixtures.append(f);continue
    if typ=='self_checkout':cat='Checkout 12'if i==950 else 'Checkout 13';asset='self-checkout';camera='checkout'
    else:
        cat=cat or {'shelf':'Scaffali senza categoria','fridge':'Scaffali senza categoria','isola':'Espositori senza categoria','tavolo':'Tavoli','entrance':'Ingresso','digital_display':'Display digitali'}.get(typ,'Espositori senza categoria')
        c=config['categories'].get(cat);assert c,cat
        asset,camera=c['asset'],c['camera']
        if typ=='fridge' and cat=='Surgelati' and i in [905,906,907]:asset='freezer-wall'
        if typ=='fridge' and cat=='Scaffali senza categoria':asset='chilled'
    if i in [186,187,188,794]:
        excluded.append({**record,'category':cat,'reason':'CAD wall/lining geometry, not a merchandise fixture; retained exactly as architecture'});continue
    pos=fit(p)
    if not pos:excluded.append({**record,'category':cat,'reason':'No safe interior rectangle; exact CAD retained'});continue
    x,z,width,length,yaw=pos
    # Duplicate mapped table at the same footprint is one physical object, not two models.
    if any(sorted(f['polygon'])==sorted(p) for f in fixtures):excluded.append({**record,'category':cat,'reason':'Duplicate footprint; represented by existing mapped fixture'});continue
    fronts=[]
    for a,b in edges(p):
        for roi in rs:
            for c,d in edges(roi['vertices']):
                if math.dist(a,b)>1.6 and min(max(math.dist(a,c),math.dist(b,d)),max(math.dist(a,d),math.dist(b,c)))<.035:fronts.append([a,b])
    f={**record,'category':cat,'asset':asset,'camera':camera,'shelfId':r['object_id'],'polygon':p,'x':x,'z':z,'width':width,'length':length,'yaw':yaw,'fronts':fronts,'tile':typ not in ['self_checkout','tavolo','digital_display','entrance']}
    if typ=='self_checkout':f['lane']=int(cat.split()[-1])
    fixtures.append(f)
for cat in sorted({f['category']for f in fixtures}|{a['id']for a in areas['departments']}):
    fs=[f for f in fixtures if f['category']==cat];ex=[e for e in excluded if e.get('category')==cat]
    analytic=next((a for a in areas['departments']if a['id']==cat),None)
    inventory.append({'category':cat,'status':'modelled'if fs else 'CAD only','fixtures':len(fs),'assets':sorted({f['asset']for f in fs}),'camera':fs[0]['camera']if fs else 'gondola','analyticGeometry':'visitor-areas.json'if analytic or cat.startswith('Checkout ')else None,'selection':'existing analytical ROI'if analytic or cat.startswith('Checkout ')else 'CAD fixture footprints only; no department KPI binding','excludedObjects':ex})
assets={k:{'url':f'./retail/{k}.glb','overviewUrl':f'./retail/{k}-l0.glb','width':1.7,'length':2.6}for k in sorted({f['asset']for f in fixtures})}
out={'schema':'retail-fixtures-v2','venueId':layout['venue']['id'],'layoutSha256':hashlib.sha256((PUBLIC/'layout_prod.json').read_bytes()).hexdigest(),'frame':baseline['frame'],'note':baseline['note'],'source':'exports/treviglio_2026-08-11: all 1119 source footprints exactly match current CAD','assumptions':config['assumptions'],'fixtures':fixtures,'assets':assets,'departments':inventory,'excluded':excluded,'unmatched':[]}
(PUBLIC/'retail/manifest.json').write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
(ROOT/'docs/design/supermarket/inventory.json').write_text(json.dumps({'source':out['source'],'departments':inventory,'excluded':excluded},indent=2,ensure_ascii=False)+'\n')
print('Matched 1119 CAD objects;',len(fixtures),'placed fixtures;',len(inventory),'selectable areas;',len(assets),'asset variants;',len(excluded),'explicit exclusions')
