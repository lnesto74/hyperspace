"""Apply the final envelope and L0 stocking rules to an already-rendered SkyRig library.
Uses the same builder functions as full regeneration; never touches approved produce.glb.
"""
import bpy,sys,json
from pathlib import Path
from mathutils import Vector
root=Path(sys.argv[sys.argv.index('--')+1]);script=Path(__file__).with_name('generate_supermarket.py')
bpy.ops.wm.open_mainfile(filepath=str(root/'supermarket-library.blend'))
sys.path.insert(0,str(script.parent));import asset_library as L
for key in ['bread','ice','cheese']:L.M[key]=bpy.data.materials[key]
# Read only the shared helper definitions, not the scene construction driver.
source=script.read_text();helpers=source[source.index('def stocking('):source.index('for name in manifest[')]
ns={'bpy':bpy,'scene':bpy.context.scene,'Vector':Vector,'cube':L.cube,'M':L.M,'out':root,'stats':{}}
exec(helpers,ns)
manifest=json.loads((script.parent/'manifest.json').read_text())
for name in manifest['assets']:
    low=[o for o in bpy.context.scene.objects if o.type=='MESH'and o.name.startswith(name+'-l0_')]
    # The old three merchandise blocks had already been batched with their own objects.
    # Retain them; new shelf masses occupy the formerly empty upper shelves.
    if name not in ['table','entrance','display','checkout','self-checkout']:
        L.objects=[];ns['stocking'](name);low+=ns['batch'](name+'-l0',L.objects,False)
    ns['export'](name+'-l0',low)
    if name=='freezer-wall':
        full=[o for o in bpy.context.scene.objects if o.type=='MESH'and o.name.startswith(name+'_') and not any(c.name=='DEPARTMENT_PREVIEWS'for c in o.users_collection)]
        ns['export'](name,full)
bpy.ops.wm.save_as_mainfile(filepath=str(root/'supermarket-library.blend'))
stats=json.loads((root/'asset-stats.json').read_text());stats['assets'].update(ns['stats']);(root/'asset-stats.json').write_text(json.dumps(stats,indent=2))
print('OVERVIEW_REFINED')
