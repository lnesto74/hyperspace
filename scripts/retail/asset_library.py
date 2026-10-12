"""Shared geometry and material primitives, extracted from the approved Frutta generator."""
import bpy, math, random
from mathutils import Vector
scene=bpy.context.scene
def mat(name,color,rough=.55,metal=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m

M={
 'steel':mat('Powder-coated graphite',(.055,.069,.072),.45,.55),
 'wood':mat('Oiled warm oak',(.29,.17,.083),.8),
 'endgrain':mat('Crate end grain',(.42,.28,.14),.75),
 'black':mat('Crate liner',(.027,.037,.027),.95),
 'label':mat('Ivory shelf label',(.81,.79,.68),.9),
 'apple':mat('Russet red apples',(.42,.055,.031),.38),
 'pear':mat('Conference green',(.28,.39,.075),.6),
 'citrus':mat('Citrus ochre',(.72,.25,.018),.64),
 'lemon':mat('Lemon yellow',(.67,.53,.037),.62),
 'leaf':mat('Leaf green',(.06,.17,.033),.82),
 'aubergine':mat('Aubergine',(.10,.025,.12),.27),
 'silver':mat('Brushed stainless',(.39,.46,.47),.35,.75),
 'white':mat('Refrigerator enamel',(.63,.69,.67),.32,.1),
 'glass':mat('Smoked glass approximation',(.18,.30,.32),.16,.3),
 'pack':mat('Dairy cartons',(.72,.78,.69),.65),
 'blue':mat('Pack blue',(.075,.19,.24),.6),
 'meat':mat('Butchery tray product',(.36,.11,.092),.64),
 'fish':mat('Fish silvery skin',(.32,.43,.44),.32,.45),
}
em=mat('Cabinet LED',(.65,.86,.87),.3)
p=next(n for n in em.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
p.inputs['Emission Color'].default_value=(.5,.8,.85,1);p.inputs['Emission Strength'].default_value=.7
M['led']=em
objects=[]

def cube(name,loc,scale,material,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(M[material]);objects.append(o)
    if bevel:
        mod=o.modifiers.new('Small manufactured edge','BEVEL');mod.width=bevel;mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def fruit(name,loc,size,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10,ring_count=6,radius=1,location=loc)
    o=bpy.context.object;o.name='detail_'+name;o.scale=size;o.data.materials.append(M[material]);objects.append(o)
    for p in o.data.polygons:p.use_smooth=True
    return o

def base():
    cube('Recessed plinth',(0,0,.10),(1.50,2.40,.20),'steel',.025)
    cube('Counter carcass',(0,0,.47),(1.63,2.53,.56),'wood',.022)
    cube('Shadow reveal',(0,0,.73),(1.66,2.56,.045),'steel')
    cube('Display deck',(0,0,.78),(1.70,2.60,.08),'endgrain',.018)

def produce():
    base()
    for x in [-.72,.72]:
        for y in [-1.13,1.13]:cube('Tubular leg',(x,y,.40),(.07,.07,.68),'steel',.01)
    assort=['apple','pear','citrus','lemon','pear','aubergine','apple','citrus']
    for row in range(4):
        for col in range(2):
            x=(col-.5)*.80;y=(row-1.5)*.625;c=assort[row*2+col]
            cube('Crate bottom',(x,y,.835),(.75,.58,.05),'black')
            for z in [.89,.97,1.05]:
                for sy in [-1,1]:cube('Open crate slat',(x,y+sy*.287,z),(.75,.027,.052),'wood')
                for sx in [-1,1]:cube('Open crate end',(x+sx*.366,y,z),(.027,.58,.052),'endgrain')
            for sx in [-1,1]:
                for sy in [-1,1]:cube('Crate corner',(x+sx*.35,y+sy*.27,.95),(.035,.035,.24),'wood')
            cube('Shelf ticket',(x,y-.305,1.055),(.22,.009,.078),'label')
            cube('Ticket rule',(x,y-.311,1.06),(.13,.006,.009),'steel')
            for i in range(5):
                for j in range(4):
                    px=x+(i-2)*.132+random.uniform(-.012,.012);py=y+(j-1.5)*.128+random.uniform(-.012,.012)
                    r=random.uniform(.063,.077);pz=.94+random.uniform(0,.018)
                    sz=(r,r,r*.90) if c not in ['pear','aubergine','lemon'] else (r*.73,r*.81,r*1.3)
                    o=fruit(c,(px,py,pz),sz,c);o.rotation_euler=(random.uniform(-.2,.2),random.uniform(-.2,.2),random.random()*6)
                    if c in ['apple','pear']:
                        cube('detail_stem',(px,py,pz+sz[2]),(.009,.009,.030),'wood')
                    if (i+j)%3==0:
                        fruit('leaf',(px+.03,py,pz+sz[2]),(.036,.015,.008),'leaf')

def dairy():
    cube('Refrigerated plinth',(0,0,.1),(1.65,2.55,.2),'steel',.025)
    cube('Cabinet back',(0,.0,1.05),(.12,2.60,1.9),'white',.015)
    for x in [-.79,.79]:
        for z in [.25,.68,1.11,1.54]:
            cube('Cold shelf',(x/2,0,z),(.78,2.58,.06),'silver',.01)
            cube('Lighted frontage',(x,0,z+.03),(.015,2.50,.018),'led')
            for j in range(12):
                cube('detail_carton',(x*.57,(j-5.5)*.20,z+.15),(.22,.15,.24),'pack',.012)
                cube('detail_brand',(x*.57,(j-5.5)*.20,z+.26),(.225,.155,.035),'blue')
    for y in [-1.26,1.26]:cube('Cabinet end',(0,y,1.02),(1.65,.08,1.85),'white',.02)
    cube('Cabinet canopy',(0,0,2.0),(1.7,2.6,.10),'steel',.02)

def cold(kind):
    cube('Chilled cabinet',(0,0,.45),(1.7,2.6,.90),'white',.035)
    cube('Recessed toe',(0,0,.07),(1.5,2.4,.14),'steel',.02)
    cube('Tray well',(0,0,.92),(1.54,2.44,.06),'silver',.015)
    for x in [-.81,.81]:cube('Rim',(x,0,1.04),(.075,2.6,.13),'silver',.015)
    for y in [-1.26,1.26]:cube('Rim',(0,y,1.04),(1.65,.075,.13),'silver',.015)
    for j in range(6):
        for i in range(3):
            x=(i-1)*.45;y=(j-2.5)*.37
            cube('detail_product_tray',(x,y,.976),(.4,.33,.035),'black',.015)
            if kind=='freezer':cube('detail_frozen_pack',(x,y,1.01),(.34,.28,.06),'blue' if j%2 else 'pack',.012)
            elif kind=='fish':fruit('whole_fish',(x,y,1.026),(.17,.067,.036),'fish')
            else:fruit('cut',(x,y,1.026),(.16,.11,.037),'meat')
    if kind=='freezer':
        for y in [-.65,.65]:cube('Sliding glass lid',(0,y,1.12),(1.53,1.23,.024),'glass',.008)
        for y in [-.10,.10]:cube('Lid handle',(0,y,1.15),(.32,.04,.045),'silver',.01)
    else:
        for x in [-.78,.78]:cube('Counter glazing',(x,0,1.26),(.02,2.54,.34),'glass',.006)
        cube('Countertop trim',(0,0,1.45),(1.7,2.6,.04),'glass',.012)

def checkout():
    cube('Checkout body',(0,0,.48),(1.65,2.55,.96),'white',.03)
    cube('Conveyor',(0,-.37,1.0),(1.35,1.65,.045),'steel',.018)
    cube('Scanner',(0,.57,1.02),(.55,.42,.075),'glass',.01)
    cube('POS stand',(.55,.89,1.22),(.06,.06,.42),'steel')
    cube('POS display',(.55,.89,1.48),(.40,.09,.27),'steel',.01)
    cube('POS screen',(.55,.835,1.48),(.34,.008,.21),'blue')

