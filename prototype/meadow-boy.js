// 原创草地男孩放风筝：透明人物贴图 + 实时风筝、线和尾带；只接入桌面草地及设置预览。
// 贴图只上传一次，人物与完整投影分别画入小纹理，再由草地合成到云层之下。
let meadowBoyScene = null;
const meadowBoyRunDuration=2,meadowBoyTurnDuration=.22;
const meadowKiteShadow=[98,134];
const meadowKiteRestHeading=-2.03;
const meadowBoyFollowMargin={left:520,top:520,right:620,bottom:650};
function meadowBoyTripPose(elapsed,cycles=4,duration=meadowBoyRunDuration,trip={}) {
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  const turn=trip.enter?0:meadowBoyTurnDuration;
  const runEnd=turn+duration,turnBackAt=runEnd+.18;
  const strideLead=trip.enter?0:.07;
  if(elapsed<turn-strideLead){
    const t=Math.max(0,elapsed/turn);
    return {frame:t<.25?3:t<.68?0:3,back:t>=.25,progress:0,running:false,squeeze:1-.2*Math.sin(t*Math.PI),bob:0,done:false};
  }
  if(elapsed<runEnd){
    const runTime=elapsed-turn,stepTime=Math.max(0,runTime+strideLead),plantTime=trip.enter?0:.02;
    // 转身最后 70ms 就开始迈步，转完仅留 20ms 落脚；加速时间不随整段路程拉长。
    const moveTime=Math.max(0,runTime-plantTime),moveDuration=duration-plantTime;
    const accelerate=.16,decelerate=.22;
    const rampIntegral=(t,r)=>{
      if(t>=r)return t-r*.5;
      const u=Math.max(0,t/r);return r*(u*u*u-.5*u*u*u*u);
    };
    const progress=Math.max(0,Math.min(1,(rampIntegral(moveTime,accelerate)-
      rampIntegral(Math.max(0,moveTime-moveDuration+decelerate),decelerate))/
      (moveDuration-(accelerate+decelerate)*.5)));
    const lead=trip.enter?0:.18;
    const phase=(lead*ease(stepTime/.10)+(cycles-lead)*progress)*Math.PI*2;
    const gait=ease(stepTime/.07)*ease((duration-runTime)/.12);
    const squeeze=elapsed<turn?1-.2*Math.sin(elapsed/turn*Math.PI):1;
    return {frame:3,back:true,progress,running:true,squeeze,phase,gait,bob:-(1-Math.cos(phase*2))*.65*gait,done:false};
  }
  if(trip.exit)return {frame:3,back:true,progress:1,running:false,squeeze:1,bob:0,done:true};
  if(elapsed<turnBackAt)return {frame:3,back:true,progress:1,running:false,squeeze:1,bob:0,done:false};
  if(elapsed<turnBackAt+meadowBoyTurnDuration){
    const t=(elapsed-turnBackAt)/meadowBoyTurnDuration;
    return {frame:t<.32?3:0,back:t<.75,progress:1,running:false,squeeze:1-.2*Math.sin(t*Math.PI),bob:0,done:false};
  }
  return {frame:3,back:false,progress:1,running:false,squeeze:1,bob:0,done:true};
}
function meadowBoyRunningRig(activity) {
  const weight=activity.gait||0,phase=activity.phase||0,bob=activity.bob||0;
  const solve=(hip,knee,ankle,offset,front,back,lift,kick)=>{
    const u=((phase/(Math.PI*2)+offset)%1+1)%1;
    const swing=u>=.5,t=swing?(u-.5)*2:u*2;
    // 离地后先屈膝收后脚，再向前送腿；鞋尖随小腿转动，避免像原地抬腿走路。
    const recovery=Math.max(0,(t-.18)/.82);
    const step=swing?recovery*recovery*(3-2*recovery):t;
    const fold=swing?Math.pow(Math.sin(Math.PI*t),2):0;
    const a=swing?back:front,b=swing?front:back;
    const x=a[0]+(b[0]-a[0])*step+kick*fold,y=a[1]+(b[1]-a[1])*step;
    const height=swing?Math.min(fold*lift,Math.max(0,y-5))*weight:0;
    const foot=[ankle[0]+(hip[0]+x-ankle[0])*weight,ankle[1]+(hip[1]+y-ankle[1])*weight-bob];
    foot[1]-=height;
    const upper=Math.hypot(knee[0]-hip[0],knee[1]-hip[1]),lower=Math.hypot(ankle[0]-knee[0],ankle[1]-knee[1]);
    const dx=foot[0]-hip[0],dy=foot[1]-hip[1],raw=Math.hypot(dx,dy);
    const distance=Math.max(Math.abs(upper-lower)+.001,Math.min(upper+lower-.001,raw));
    const ux=dx/Math.max(raw,.001),uy=dy/Math.max(raw,.001);
    foot[0]=hip[0]+ux*distance;foot[1]=hip[1]+uy*distance;
    const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
    const bend=Math.sqrt(Math.max(0,upper*upper-along*along));
    const joint=[hip[0]+ux*along-uy*bend,hip[1]+uy*along+ux*bend];
    return {hip,knee:joint,ankle:foot,angle:-fold*1.05*weight,contact:!swing,lift:height};
  };
  return {
    left:solve([-12,37],[-14,47],[-15,57],0,[-7.5,8.5],[1.4,19],19,9),
    right:solve([14,35],[18,44],[21,51],.5,[.5,7.2],[7,15.8],16,5),
    arm:-Math.sin(phase)*.42*weight,
    // 持线轮的右臂跟着步频小幅前后摆，和空着的左臂相反，仍保持抬起。
    reelArm:(Math.sin(phase)*.26+Math.sin(phase*2)*.035)*weight
  };
}
function meadowBoyGroundPose(activity,rig,pose) {
  let feet,soles;
  if(activity.running){
    const heel=(leg,offset)=>{
      const c=Math.cos(leg.angle),s=Math.sin(leg.angle);
      return [leg.ankle[0]+c*offset[0]-s*offset[1],leg.ankle[1]+s*offset[0]+c*offset[1]+activity.bob-10];
    };
    soles=[heel(rig.left,[-.52,15.94]),heel(rig.right,[-3.42,15.63])];
    feet=soles.map((p,i)=>[p[0],p[1]+(i?rig.right.lift:rig.left.lift)]);
  }else if(activity.back){
    const rest=activity.frame===0?[[-10.06,78.11],[23.76,72.66]]:[[-15.52,72.94],[17.58,66.63]];
    feet=rest.map(p=>[p[0]*activity.squeeze,p[1]+activity.bob-10]);soles=feet;
  }else{
    feet=[[-22.5*activity.squeeze,72.0],[37.8*activity.squeeze,63.3]];
    soles=feet.map((p,i)=>[p[0]+(i?1:-1)*pose.legs[i]*.24*activity.squeeze,p[1]-pose.legs[i]]);
  }
  // 通过两只鞋的地面位置定义投影基线，支撑脚与完整人影在同一点相接。
  // 跑步沿用斜背面站姿的地面倾角，避免抬起的鞋越过另一条腿时投影突然伸长。
  const dx=feet[1][0]-feet[0][0],spacing=Math.sign(dx||1)*Math.max(12,Math.abs(dx));
  const slope=activity.running?-.19:Math.max(-.8,Math.min(.5,(feet[1][1]-feet[0][1])/spacing));
  // 后脚收起时两只鞋可能在画面上重叠，仍以实际支撑脚固定投影，避免影子离地。
  const support=activity.running?soles[rig.left.contact?0:1]:null;
  const intercept=support?support[1]-slope*support[0]:(feet[0][1]+feet[1][1]-slope*(feet[0][0]+feet[1][0]))*.5;
  const contacts=feet.map((p,i)=>[p[0],p[1]-.5,activity.running?((i?rig.right:rig.left).contact?1:.22):1]);
  return {line:[slope,intercept],contacts,soles};
}
function meadowBoyRunDestination(from,s,width,height,taskbar) {
  const distance=Math.min(Math.max(165,(height-taskbar)*.27),315);
  // 接近上沿就继续跑出整个人物、风筝与投影，不在边缘停成半截。
  const exit=from.y-distance<116*s+24;
  const y=exit?-meadowBoyFollowMargin.bottom*s-24:from.y-distance;
  // 保留向左斜上方的路线；窄屏接近左边时让路线变陡，避免从侧面消失。
  const x=Math.max(96*s+12,from.x-(from.y-y)*.65);
  return {x,y,exit};
}
function meadowBoyCursorTarget(cursor,s,width,height,taskbar) {
  if(!cursor||!Number.isFinite(cursor.x)||!Number.isFinite(cursor.y))return null;
  const {left,top,right,bottom}=meadowBoyFollowMargin;
  const maxX=Math.max(96*s+12,width-right*s-12),minX=Math.min(left*s+12,maxX);
  const maxY=Math.max(116*s+12,height-taskbar-bottom*s-12),minY=Math.min(top*s+12,maxY);
  return {x:Math.max(minX,Math.min(maxX,cursor.x)),y:Math.max(minY,Math.min(maxY,cursor.y))};
}
function meadowBoyCatObstacle(cat,s) {
  if(!cat)return null;
  // 按整个剪影留出距离，猫伸爪时也有空隙。
  return {x:cat.x,y:cat.y+6*s,rx:cat.size*.58+82*s+5,ry:cat.size*.58+96*s+5};
}
function meadowBoyCatLocal(p,cat) {
  return {x:(p.x-cat.x)/cat.rx,y:(p.y-cat.y)/cat.ry};
}
function meadowBoyCatClear(a,b,radius=1) {
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,-(a.x*dx+a.y*dy)/(dx*dx+dy*dy||1)));
  return (a.x+dx*t)**2+(a.y+dy*t)**2>=radius**2-1e-6;
}
function meadowBoyCatRoute(from,to,cat,bounds=null,preferredSide=0) {
  if(!cat)return {points:[to],side:0};
  const local=p=>meadowBoyCatLocal(p,cat);
  const world=p=>({x:cat.x+p.x*cat.rx,y:cat.y+p.y*cat.ry});
  const a=local(from),b=local(to);
  const aLength=Math.hypot(a.x,a.y);
  const bLength=Math.hypot(b.x,b.y);
  // 鼠标停在猫身上时，男孩留在猫的这一侧。
  if(bLength<1.10){
    if(aLength<1e-6)return {points:[from],side:0};
    const edge=world({x:a.x*1.10/aLength,y:a.y*1.10/aLength});
    return {points:[bounds?bounds(edge):edge],side:0};
  }
  if(aLength<1||meadowBoyCatClear(a,b))return {points:[to],side:0};
  const count=12;
  const nodes=Array.from({length:count},(_,i)=>{
    const angle=i*Math.PI*2/count;
    const node={x:Math.cos(angle)*1.14,y:Math.sin(angle)*1.14};
    return local(bounds?bounds(world(node)):world(node));
  });
  const distance=(p,q)=>Math.hypot((p.x-q.x)*cat.rx,(p.y-q.y)*cat.ry);
  let best=null,bestCost=Infinity;
  for(let start=0;start<count;start++){
    if(!meadowBoyCatClear(a,nodes[start]))continue;
    for(const side of [-1,1]){
      let cost=distance(a,nodes[start]),index=start;
      const path=[];
      for(let n=0;n<count;n++){
        const node=nodes[index];
        path.push(node);
        // 选定绕行方向后给它一点优先，鼠标小幅移动时不会来回变道。
        const total=cost+distance(node,b)+(preferredSide&&preferredSide!==side?cat.rx*.65:0);
        if(total<bestCost&&meadowBoyCatClear(node,b)){
          bestCost=total;best={points:[...path.map(world),to],side};
        }
        const next=(index+side+count)%count;
        if(!meadowBoyCatClear(node,nodes[next]))break;
        cost+=distance(node,nodes[next]);index=next;
      }
    }
  }
  return best||{points:[from],side:0};
}
function meadowBoyFollow(position,target,follow,dt,s,cat=null,bounds=null) {
  const smooth=1-Math.exp(-dt/.24);
  follow.x+=(target.x-follow.x)*smooth;
  follow.y+=(target.y-follow.y)*smooth;
  const route=meadowBoyCatRoute(position,follow,cat,bounds,follow.catSide);
  follow.catSide=route.side;
  const waypoint=route.points.find(p=>Math.hypot(p.x-position.x,p.y-position.y)>1)||route.points.at(-1);
  const dx=waypoint.x-position.x,dy=waypoint.y-position.y,distance=Math.hypot(dx,dy);
  const start=Math.max(24,76*s),stop=start*.55;
  // 鼠标在身边小幅移动不追；起跑后减速到舒服的跟随距离。
  const remaining=route.side?Infinity:distance;
  if(follow.moving?remaining<=stop:remaining>=start)follow.moving=!follow.moving;
  const maxSpeed=Math.max(48,Math.min(78,200*s));
  const desired=follow.moving?Math.min(maxSpeed,(remaining-stop)*2.3):0;
  const vx=distance>0?dx/distance*desired:0,vy=distance>0?dy/distance*desired:0;
  const change=Math.hypot(vx-follow.vx,vy-follow.vy);
  const blend=change>0?Math.min(1,(desired>0?155:220)*dt/change):0;
  follow.vx+=(vx-follow.vx)*blend;follow.vy+=(vy-follow.vy)*blend;
  let next={x:position.x+follow.vx*dt,y:position.y+follow.vy*dt};
  if(bounds)next=bounds(next);
  if(cat){
    const a=meadowBoyCatLocal(position,cat),b=meadowBoyCatLocal(next,cat);
    if(!meadowBoyCatClear(a,b)){
      // 惯性可能把脚带进避让范围，沿本帧安全方向重试这一步。
      const step=Math.min(distance,Math.hypot(follow.vx,follow.vy)*dt);
      let safe=distance>0?{x:position.x+dx/distance*step,y:position.y+dy/distance*step}:position;
      if(bounds)safe=bounds(safe);
      const safeLocal=meadowBoyCatLocal(safe,cat),inside=Math.hypot(a.x,a.y)<1;
      if(inside?Math.hypot(safeLocal.x,safeLocal.y)>Math.hypot(a.x,a.y):meadowBoyCatClear(a,safeLocal)){
        next=safe;
      }else next=position;
      if(dt>0){follow.vx=(next.x-position.x)/dt;follow.vy=(next.y-position.y)/dt;}
    }
  }
  const speed=Math.hypot(follow.vx,follow.vy);
  Object.assign(position,next);
  const running=speed>3;
  if(speed>10){
    // 略微抖动或横向移动时保留朝向，明显朝上才切换背面。
    follow.back=follow.vy/speed<(follow.back?-.22:-.48);
  }
  const gait=Math.min(1,speed/(maxSpeed*.66));
  if(running)follow.phase=(follow.phase+speed*dt/Math.max(27,112*s))%1;
  else follow.phase=0;
  const phase=follow.phase*Math.PI*2,frontRun=running&&!follow.back;
  return {frame:3,back:running&&follow.back,frontRun,frontFrame:Math.floor(follow.phase*4),
    lean:follow.vx/maxSpeed*.12,progress:1,running,squeeze:1,phase,gait,
    bob:running?-(1-Math.cos(phase*2))*(frontRun?1.45:.65)*gait:0,done:false};
}
function meadowBoyTugPose(age) {
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  if(age<0||age>=1.12)return {active:false,reach:0,pull:0};
  const reach=ease(age/.16)*(1-ease((age-.16)/.20));
  const pull=ease((age-.16)/.20)*(1-ease((age-.50)/.62));
  return {active:true,reach,pull};
}
function meadowBoyKiteReaction(reaction,dt,impulse,dx,dy) {
  // 手把线拉紧时给风筝一次冲量，弹性回复与阻尼使它摆过头后逐渐停稳。
  reaction.vx+=135*impulse*dx;reaction.vy+=135*impulse*dy;reaction.spin+=2.8*impulse;
  reaction.vx+=(-18*reaction.x-3.4*reaction.vx)*dt;
  reaction.vy+=(-22*reaction.y-4*reaction.vy)*dt;
  reaction.spin+=(-24*reaction.angle-3.8*reaction.spin)*dt;
  reaction.x+=reaction.vx*dt;reaction.y+=reaction.vy*dt;reaction.angle+=reaction.spin*dt;
}
function meadowKiteHeading(vx,vy) {
  // 风筝沿跑动的反方向拖行，侧风让它偏离正后方一点。
  return Math.atan2(-vy,-vx)-.42;
}
function meadowKiteBounds(x,y,angle) {
  const c=Math.cos(angle),s=Math.sin(angle);
  // 同时包住菱形本体和尾带摆到最外侧的位置。
  const corners=[[-57,-76],[57,-76],[-57,176],[105,176],[105,64]];
  const xs=corners.map(([px,py])=>x+c*px-s*py);
  const ys=corners.map(([px,py])=>y+s*px+c*py);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
function meadowBoyWavePull(time,tug) {
  if(tug.active)return 0;
  const wave=Math.max(0,Math.min(1,((time%9)-4)/.6));
  return Math.pow(Math.sin(Math.PI*wave),2);
}
function meadowBoyPose(time,tug={active:false,reach:0,pull:0}) {
  const pull=Math.pow(.5+.5*Math.sin(time*1.35),3);
  const shift=Math.sin(time*1.05);
  const body=[Math.sin(time*.85)*1.7-tug.pull*1.8,Math.sin(time*1.7)*.65-tug.pull*.8];
  const tugOffset=[tug.reach*4-tug.pull*12,tug.reach*3-tug.pull*8];
  // 保持头部朝向，不再左右镜像转头。
  const look=1;
  // 平时保持抬手姿势，每隔九秒快速挥动一次，约 0.6 秒内挥出再收回。
  const reel=-.18+(tug.active?-tug.pull*.22:meadowBoyWavePull(time,tug)*1.14);
  // 素材中右手在线轮下方握柄；端点和抬手部件共用肩关节、角度及拉线位移。
  const angle=reel+.18,c=Math.cos(angle),s=Math.sin(angle);
  const armPoint=(x,y)=>{
    const q=[-21.+c*(x+21.)-s*(y+9.)-tugOffset[0]*.35,
      -9.+s*(x+21.)+c*(y+9.)-tugOffset[1]*.35];
    const py=(q[1]+body[1]*78/170)/(1+body[1]/170);
    return [q[0]+body[0]*(78-py)/170,py];
  };
  const reelHand=armPoint(-49.,-45.5);
  return {
    head:0,
    look,
    nod:Math.sin(time*.9+.4)*1.5,
    reel,
    pull,
    tugOffset,
    body,
    legs:[Math.max(0,shift)*3.8,Math.max(0,-shift)*3.2],
    hand:reelHand.slice(),
    reelHand
  };
}
function drawMeadowBoy(now) {
  return prepareMeadowBoy(now);
}
function prepareMeadowBoy(now,visible=true,cursor=null,cat=null) {
  if (!meadowBoyScene) meadowBoyScene = createMeadowBoyScene();
  return meadowBoyScene.draw(now,visible,cursor,cat);
}
function createMeadowBoyScene() {
  const shader = program(`#version 300 es
precision highp float;
uniform sampler2D uCharacter, uRunSprite, uFrontRunSprite;
uniform vec2 uRes, uOffset, uKite, uKiteShadow, uBody, uLegs, uHand, uReelHand, uTug;
uniform vec4 uPose, uMotion;
uniform vec3 uFrontRun; // enabled, frame, horizontal lean
uniform vec4 uLeftHipKnee, uRightHipKnee, uRig;
uniform vec2 uLeftAnkle, uRightAnkle, uFootAngles;
uniform vec2 uGround;
uniform vec3 uContactL, uContactR;
uniform vec3 uPlace;
uniform float uScale, uTime, uLook, uShadow, uRunWind, uTension, uKiteRock, uKiteAngle;
layout(location=0) out vec4 o;
layout(location=1) out vec4 oPerson;
vec4 over(vec4 base, vec4 top) {
  float alpha=top.a+base.a*(1.-top.a);
  return vec4((top.rgb*top.a+base.rgb*base.a*(1.-top.a))/max(alpha,.001),alpha);
}
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/max(dot(v,v),.001),0.,1.));
}
vec2 turn(vec2 p,float angle) {
  float c=cos(angle),s=sin(angle);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);
}
vec2 bodySpace(vec2 p) {
  return p-uBody*clamp((78.-p.y)/170.,0.,1.);
}
float armMask(vec2 p) {
  float boundary=p.y < -30. ? -38.+(-p.y-30.)*.10 : min(-17.,-38.+(p.y+30.)*.78);
  return (1.-smoothstep(boundary-.45,boundary+.45,p.x))*(1.-smoothstep(0.,3.,p.y));
}
vec4 spriteColor(vec4 color,vec2 p) {
  color.a*=step(-76.,p.x)*step(-95.,p.y)*step(p.x,76.)*step(p.y,85.);
  return color;
}
vec2 spriteUV(vec2 p) {
  return clamp((p+vec2(76.,95.))/vec2(152.,180.),.002,.998);
}
vec2 personSource(vec2 p) {
  vec2 boy=bodySpace(p);
  vec2 rest=boy;
  // 站着交替提脚、挪重心；膝盖往上逐渐固定，裤腿不会被整体拉走。
  float lower=smoothstep(24.,48.,rest.y);
  float right=smoothstep(-4.,9.,rest.x);
  float lift=mix(uLegs.x,uLegs.y,right);
  boy.y+=lift*lower;
  boy.x-=(right*2.-1.)*lift*.24*lower;
  return boy;
}
float ribbon(vec2 p,float offset,float phase) {
  float t=clamp(p.y/108.,0.,1.);
  float gust=sin(t*5.6-uTime*4.8+phase)*uRunWind*9.+sin(t*6.-uTime*7.+phase)*abs(uKiteRock)*12.;
  float center=offset+50.*t+(12.*sin(t*4.8-uTime*1.15+phase)+gust)*t;
  float width=mix(3.4,1.6,t);
  return (1.-smoothstep(width,width+1.,abs(p.x-center)))*step(0.,p.y)*step(p.y,108.);
}
vec4 kiteColor(vec2 p,vec2 screen) {
  vec4 result=vec4(0.);
  vec2 delta=p-uKite;
  vec2 q=turn(delta,-uKiteAngle);
  vec2 tail=q-vec2(2.,65.);
  result=over(result,vec4(.88,.65,.37,ribbon(tail,0.,0.)));
  result=over(result,vec4(.81,.39,.30,ribbon(tail,8.,.45)));
  result=over(result,vec4(.32,.55,.62,ribbon(tail,16.,.9)));
  float diamond=abs(q.x)/53.+abs(q.y)/70.;
  float coverage=1.-smoothstep(mix(.97,.94,uShadow),mix(1.025,1.07,uShadow),diamond);
  vec3 fabric=q.y<0.?(q.x<0.?vec3(.95,.77,.42):vec3(.88,.43,.33)):
    (q.x<0.?vec3(.94,.77,.44):vec3(.35,.57,.64));
  float grain=fract(sin(dot(floor(screen*1.7),vec2(12.9898,78.233)))*43758.5453);
  fabric*=.97+grain*.06;
  fabric=mix(fabric,vec3(.46,.40,.25),smoothstep(.93,1.0,diamond)*.78);
  float seams=1.-smoothstep(.35,.9,min(abs(q.x),abs(q.y)));
  fabric=mix(fabric,vec3(.98,.92,.71),seams*.65);
  return over(result,vec4(fabric,coverage));
}
vec4 standingBoy(vec2 p,float lod) {
  return spriteColor(textureLod(uRunSprite,(spriteUV(p)+vec2(1.))*.5,lod),p);
}
vec2 boneSource(vec2 p,vec2 sourceA,vec2 sourceB,vec2 posedA,vec2 posedB) {
  vec2 v=posedB-posedA,s=sourceB-sourceA;
  float lengthV=max(length(v),.001),lengthS=max(length(s),.001);
  vec2 axis=v/lengthV,normal=vec2(-axis.y,axis.x),sourceAxis=s/lengthS;
  return sourceA+s*(dot(p-posedA,axis)/lengthV)+vec2(-sourceAxis.y,sourceAxis.x)*dot(p-posedA,normal);
}
float rigMask(vec2 p,float side,float y0,float y1) {
  float xMask=mix(1.-smoothstep(-2.,1.,p.x),smoothstep(2.,5.,p.x),step(0.,side));
  return xMask*smoothstep(y0-.6,y0+.6,p.y)*(1.-smoothstep(y1-.6,y1+.6,p.y));
}
vec4 rigPiece(vec2 source,float side,float y0,float y1,float lod) {
  vec4 color=standingBoy(source,lod);color.a*=rigMask(source,side,y0,y1);return color;
}
vec4 rigJoint(vec2 p,vec2 center,vec3 color,float radius) {
  float d=length(p-center);
  vec4 edge=vec4(.26,.18,.12,1.-smoothstep(radius+.2,radius+.8,d));
  return over(edge,vec4(color,1.-smoothstep(radius-.6,radius,d)));
}
float runnerArmMask(vec2 p) {
  return (1.-smoothstep(-25.,-21.,p.x))*smoothstep(-8.,-3.,p.y)*(1.-smoothstep(29.,31.,p.y));
}
float runnerReelArmMask(vec2 p) {
  // 沿头发与线轮之间的透明缝拆开，摆臂不会带走头发边缘。
  float boundary=p.y < -50. ? 32. : p.y < -43. ? mix(31.,34.,(p.y+50.)/7.) :
    p.y < -34. ? mix(34.,28.,(p.y+43.)/9.) : mix(28.,23.,clamp((p.y+34.)/14.,0.,1.));
  return smoothstep(boundary-.5,boundary+.5,p.x)*(1.-smoothstep(2.,6.,p.y));
}
vec4 runningBoy(vec2 p,vec4 trunk,float lod) {
  vec2 lh=vec2(-12.,37.),lk=vec2(-14.,47.),la=vec2(-15.,57.);
  vec2 rh=vec2(14.,35.),rk=vec2(18.,44.),ra=vec2(21.,51.);
  vec2 leftThigh=boneSource(p,lh,lk,uLeftHipKnee.xy,uLeftHipKnee.zw);
  vec2 leftShin=boneSource(p,lk,la,uLeftHipKnee.zw,uLeftAnkle);
  vec2 leftFoot=la+turn(p-uLeftAnkle,-uFootAngles.x);
  vec2 rightThigh=boneSource(p,rh,rk,uRightHipKnee.xy,uRightHipKnee.zw);
  vec2 rightShin=boneSource(p,rk,ra,uRightHipKnee.zw,uRightAnkle);
  vec2 rightFoot=ra+turn(p-uRightAnkle,-uFootAngles.y);
  // 同一张站立图拆成髋、膝、踝和鞋，连续改变关节位置，避免换图导致比例跳动。
  vec4 left=rigJoint(p,uLeftHipKnee.zw,vec3(.98,.76,.47),3.5);
  left=over(left,rigJoint(p,uLeftAnkle,vec3(.97,.96,.88),2.8));
  left=over(left,rigPiece(leftThigh,-1.,35.5,49.,lod));
  left=over(left,rigPiece(leftShin,-1.,47.,58.5,lod));
  left=over(left,rigPiece(leftFoot,-1.,56.5,74.,lod));
  vec4 right=rigJoint(p,uRightHipKnee.zw,vec3(.98,.76,.47),3.5);
  right=over(right,rigJoint(p,uRightAnkle,vec3(.97,.96,.88),2.8));
  right=over(right,rigPiece(rightThigh,1.,34.5,46.,lod));
  right=over(right,rigPiece(rightShin,1.,44.,53.,lod));
  right=over(right,rigPiece(rightFoot,1.,51.5,68.,lod));
  float cut=max(rigMask(p,-1.,37.,86.),rigMask(p,1.,36.,86.));
  trunk.a*=(1.-cut)*(1.-runnerArmMask(p))*(1.-runnerReelArmMask(p));
  vec2 armSource=vec2(-23.,-5.)+turn(p-vec2(-23.,-5.),-uRig.y);
  vec4 arm=standingBoy(armSource,lod);arm.a*=runnerArmMask(armSource);
  // 围绕右肩转动整段手臂与线轮，和 JS 里的连线端点使用同一变换。
  vec2 reelPivot=vec2(22.,-7.);
  vec2 reelSource=reelPivot+turn(p-reelPivot,-uRig.z);
  vec4 reelArm=standingBoy(reelSource,lod);reelArm.a*=runnerReelArmMask(reelSource);
  vec4 legs=mix(over(left,right),over(right,left),step(uRightAnkle.y,uLeftAnkle.y));
  legs=over(legs,rigJoint(p,vec2(-23.,-5.),vec3(.87,.24,.18),4.5));
  legs=over(legs,rigJoint(p,reelPivot,vec3(.87,.24,.18),5.0));
  return over(over(over(legs,trunk),arm),reelArm);
}
vec4 characterColor(vec2 p) {
  if(uFrontRun.x>.5){
    p.x-=uFrontRun.z*(75.-p.y);
    p.y-=uMotion.w;
    vec2 cell=vec2(mod(uFrontRun.y,2.),floor(uFrontRun.y*.5));
    return spriteColor(textureLod(uFrontRunSprite,(spriteUV(p)+cell)*.5,uShadow*2.8),p);
  }
  p.x/=uMotion.z;
  vec2 boy=personSource(p),space=bodySpace(p);
  // 直接使用新男孩全身素材；右手本来就在画面左侧，不再镜像人物或拼旧身体。
  vec2 pivot=vec2(-21.,-9.);
  vec2 armSource=pivot+turn(space+uTug*.35-pivot,-(uPose.z+.18));
  float lod=uShadow*2.8;
  vec4 person=spriteColor(textureLod(uCharacter,spriteUV(boy),lod),boy);
  vec4 arm=spriteColor(textureLod(uCharacter,spriteUV(armSource),lod),armSource);
  person.a*=1.-armMask(boy);
  arm.a*=armMask(armSource);
  // 肩关节留在手臂后面，挥手和拉线时袖口不会断开。
  vec4 shoulder=rigJoint(space,pivot,vec3(.90,.22,.16),5.0);
  vec4 front=over(over(person,shoulder),arm);
  vec2 runPoint=p-vec2(0.,uMotion.w-10.);
  vec2 cell=vec2(mod(uMotion.x,2.),floor(uMotion.x*.5));
  vec4 back=spriteColor(textureLod(uRunSprite,(spriteUV(runPoint)+cell)*.5,lod),runPoint);
  back=mix(back,runningBoy(runPoint,back,lod),uRig.x);
  return mix(front,back,uMotion.y);
}
void main() {
  vec2 screen=uOffset+vec2(gl_FragCoord.x/uScale,uRes.y-gl_FragCoord.y/uScale);
  vec2 p=(screen-uPlace.xy)/uPlace.z;
  // 投影经过当前鞋底的地面位置，保持向右下的光向，不再使用固定的离地偏移。
  float sy=(p.y-uGround.x*p.x-uGround.y)/(uGround.x*.46-.64);
  vec2 projected=vec2(p.x+.46*sy,uGround.x*(p.x+.46*sy)+uGround.y+sy);
  vec2 personPoint=mix(p,projected,uShadow);
  vec4 person=characterColor(personPoint);
  // 风筝较高：整只风筝与三条尾带一起投影，方向和云影一致。
  vec4 kite=kiteColor(p-uShadow*uKiteShadow,screen);
  if(uShadow>.5){
    float contactL=(1.-smoothstep(.65,1.15,length((p-uContactL.xy)/vec2(7.,2.6))))*uContactL.z;
    float contactR=(1.-smoothstep(.65,1.15,length((p-uContactR.xy)/vec2(7.,2.6))))*uContactR.z;
    float silhouette=max(max(person.a,kite.a),max(contactL,contactR));
    o=vec4(vec3(silhouette),1.);
    return;
  }
  vec2 hand=uHand,attach=uKite+turn(vec2(-41.,-16.),uKiteAngle);
  vec2 control=mix(hand,attach,.5)+vec2(-13.+sin(uTime*.8)*6.,18.)*(1.-uTension*.85);
  float line=1e5;vec2 previous=hand;
  for(int i=1;i<=6;i++) {
    float t=float(i)/6.;vec2 point=mix(mix(hand,control,t),mix(control,attach,t),t);
    line=min(line,segment(p,previous,point));previous=point;
  }
  // 线从线轮伸向身后，和风筝一起被人物遮住。
  float lineEdge=max(1.1,1./(uPlace.z*uScale));
  vec4 stringColor=vec4(.94,.92,.77,(1.-smoothstep(.4,lineEdge,line))*.9);
  oPerson=person;
  o=over(over(kite,stringColor),person);
}`);
  const texture=gl.createTexture(),runTexture=gl.createTexture(),frontRunTexture=gl.createTexture();
  const framebuffer=gl.createFramebuffer(),layers=Array.from({length:3},()=>gl.createTexture());
  let targetWidth=0,targetHeight=0,layerScale=0;
  let ready=0,position=null,target=null,signature='',lastCheck=-Infinity,previousTime=null,time=0;
  let trip=null,nextRunAt=7,kitePosition=null,lastScale=0,returnAt=null,follow=null;
  let kiteHeading=meadowKiteRestHeading,desiredHeading=meadowKiteRestHeading;
  let frontReady=false;
  let nextPullAt=2.2,pullStarted=-Infinity,lastLinePull=0;
  const kiteReaction={x:0,y:0,vx:0,vy:0,angle:0,spin:0};
  const startTrip=(from,to,s,flags={})=>{
    const {cat,...tripFlags}=flags;
    const path=[{...from},...meadowBoyCatRoute(from,to,cat).points];
    const lengths=path.slice(1).map((p,i)=>Math.hypot(p.x-path[i].x,p.y-path[i].y));
    const distance=lengths.reduce((sum,length)=>sum+length,0);
    const cycles=Math.max(2,Math.round(distance/(s*80)));
    return {start:time,to:path.at(-1),path,lengths,distance,
      // 长路程增加迈步次数，保留清楚的收腿动作，不靠加快步频赶完。
      duration:Math.max(meadowBoyRunDuration,distance/55,cycles*.52),cycles,...tripFlags};
  };
  function loadSprite(path,unit,targetTexture,size=384,onReady=()=>ready++){
    const image=new Image();
    image.onload=()=>{
      const sprite=document.createElement('canvas');sprite.width=sprite.height=size;
      sprite.getContext('2d').drawImage(image,0,0,size,size);
      gl.activeTexture(unit);gl.bindTexture(gl.TEXTURE_2D,targetTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sprite);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      onReady();
    };
    image.onerror=()=>console.warn('草地放风筝人物素材加载失败：'+path);
    image.src=path;
  }
  loadSprite('assets/meadow-kite-boy-level-face.png',gl.TEXTURE4,texture);
  loadSprite('assets/meadow-kite-boy-diagonal-run.png',gl.TEXTURE7,runTexture,768);
  loadSprite('assets/meadow-kite-boy-front-run.png',gl.TEXTURE9,frontRunTexture,768,()=>{frontReady=true;});
  const choosePosition=(s)=>{
    let best=null,bestScore=Infinity;
    const candidates=[];
    if(position)candidates.push({...position});
    for(const fy of [.48,.38,.58,.28])for(const fx of [.50,.62,.38,.70,.28])candidates.push({x:W*fx,y:(H-TASKBAR)*fy});
    const preferred=position||{x:W*.5,y:(H-TASKBAR)*.48};
    for(const candidate of candidates){
      if(candidate.x-96*s<12||candidate.x+612*s>W-12||candidate.y-116*s<12||candidate.y+610*s>H-TASKBAR-12)continue;
      const score=Math.hypot(candidate.x-preferred.x,candidate.y-preferred.y)*.01;
      if(score<bestScore){best=candidate;bestScore=score;}
    }
    return best||{x:W*.48,y:(H-TASKBAR)*.40};
  };
  return {draw(now,visible=true,cursor=null,cat=null){
    if(ready<2)return null;
    const dt=previousTime===null?0:Math.min(.05,Math.max(0,(now-previousTime)/1000));previousTime=now;time+=dt;
    const s=Math.max(.24,Math.min(1.25,W/1379,(H-TASKBAR)/1141))*.35;
    const obstacle=meadowBoyCatObstacle(cat,s);
    const clampFollow=p=>meadowBoyCursorTarget(p,s,W,H,TASKBAR);
    if(now-lastCheck>500){
      lastCheck=now;
      // 移动或增删图标不会打断人物跑步，仅在画面尺寸变化时重新定位。
      const next=[W,H,TASKBAR].join(',');
      if(signature!==next){
        signature=next;target=choosePosition(s);follow=null;
        if(trip)trip=null;
        nextRunAt=time+7;
      }
    }
    const cursorTarget=clampFollow(cursor);
    let activity;
    if(cursorTarget){
      // 鼠标目标永远限制在屏内安全区域，不复用自动路线的 exit 语义。
      if(returnAt!==null||!position||position.y>H||position.x<0||position.x>W){
        position=choosePosition(s);
        kitePosition=null;
      }
      if(!follow)follow={...position,vx:0,vy:0,moving:false,back:Boolean(trip),phase:0};
      returnAt=null;trip=null;nextRunAt=time+18;
      activity=meadowBoyFollow(position,cursorTarget,follow,dt,s,obstacle,clampFollow);
      target={...position};
    }else{
      follow=null;
      if(returnAt!==null){
        if(time<returnAt)return null;
        // 在整个画面之外换到下方，重新跑入时人物、牵线和风筝一起连续出现。
        position={x:Math.max(96*s+12,Math.min(W*.70,W-612*s-12)),y:H+116*s+24};
        const y=(H-TASKBAR)*.70;
        const destination={x:Math.max(96*s+12,position.x-(position.y-y)*.65),y};
        target={...destination};trip=startTrip(position,destination,s,{enter:true,cat:obstacle});
        kitePosition=null;returnAt=null;pullStarted=-Infinity;lastLinePull=0;
        Object.keys(kiteReaction).forEach(key=>kiteReaction[key]=0);
      }
      if(!position)position={...target};
      if(!trip){
        const move=1-Math.exp(-dt*.7);position.x+=(target.x-position.x)*move;position.y+=(target.y-position.y)*move;
        if(time>=nextRunAt&&Math.hypot(position.x-target.x,position.y-target.y)<2){
          const destination=meadowBoyRunDestination(position,s,W,H,TASKBAR);
          trip=startTrip(position,destination,s,{exit:destination.exit,cat:obstacle});
          pullStarted=-Infinity;
        }
      }
    }
    if(!activity)activity=trip?meadowBoyTripPose(time-trip.start,trip.cycles,trip.duration,trip):meadowBoyTripPose(6);
    let tripDirection;
    if(trip){
      let left=trip.distance*activity.progress,index=0;
      while(index<trip.lengths.length-1&&left>trip.lengths[index])left-=trip.lengths[index++];
      const from=trip.path[index],to=trip.path[index+1];
      const progress=trip.lengths[index]?left/trip.lengths[index]:0;
      tripDirection={x:to.x-from.x,y:to.y-from.y};
      position.x=from.x+tripDirection.x*progress;
      position.y=from.y+tripDirection.y*progress;
      if(activity.done){
        if(trip.exit){trip=null;returnAt=time+6;return null;}
        target=trip.after||{...position};trip=null;nextRunAt=time+18;nextPullAt=Math.max(nextPullAt,time+2.2);
      }
    }
    const waveTime=time%9;
    if(!trip&&!activity.running&&time>=nextPullAt&&nextRunAt-time>3.6&&(waveTime<2.8||waveTime>5)){
      pullStarted=time;nextPullAt=time+7.8;
    }
    const tug=meadowBoyTugPose(time-pullStarted);
    // 快速挥动持线手和专门拉线共用反馈，避免手先动、等下一次拉线才带动风筝。
    const linePull=activity.back||activity.running?0:Math.max(tug.pull,meadowBoyWavePull(time,tug));
    if(follow&&activity.running&&Math.hypot(follow.vx,follow.vy)>8){
      desiredHeading=meadowKiteHeading(follow.vx,follow.vy);
    }else if(tripDirection&&activity.running&&(tripDirection.x||tripDirection.y)){
      desiredHeading=meadowKiteHeading(tripDirection.x,tripDirection.y);
    }else if(!follow&&!trip){
      desiredHeading=meadowKiteRestHeading;
    }
    // 按最短弧转向，转弯时线的另一端滞后一拍，避免风筝跳到另一边。
    const headingError=desiredHeading-kiteHeading;
    const turn=Math.atan2(Math.sin(headingError),Math.cos(headingError));
    if(!kitePosition)kiteHeading=desiredHeading;
    else kiteHeading+=turn*(1-Math.exp(-dt/.19));
    const trailX=Math.cos(kiteHeading),trailY=Math.sin(kiteHeading);
    meadowBoyKiteReaction(kiteReaction,dt,Math.max(0,linePull-lastLinePull),-trailX,-trailY);
    lastLinePull=linePull;
    // 跑动时平滑加强横向摆幅，起跑、停步后逐渐恢复平时的轻摆。
    const runWind=activity.running?(follow?activity.gait*.38:Math.sin(Math.PI*activity.progress)):0;
    const distance=266+Math.sin(time*.49+.6)*10+runWind*13;
    const crosswind=Math.sin(time*.72)*19+Math.sin(time*4.8)*runWind*22;
    const baseKx=trailX*distance-trailY*crosswind;
    const baseKy=trailY*distance+trailX*crosswind;
    const desiredKite={x:position.x+baseKx*s,y:position.y+baseKy*s};
    if(!kitePosition||lastScale!==s)kitePosition={...desiredKite};lastScale=s;
    const kiteFollow=1-Math.exp(-dt/.16);
    kitePosition.x+=(desiredKite.x-kitePosition.x)*kiteFollow;
    kitePosition.y+=(desiredKite.y-kitePosition.y)*kiteFollow;
    // 限制松弛量，拉线时立刻把风筝拉向男孩，松手后保留弹性摆动。
    const lagX=(kitePosition.x-desiredKite.x)/s,lagY=(kitePosition.y-desiredKite.y)/s;
    const slack=Math.min(1,34/Math.max(1,Math.hypot(lagX,lagY)));
    const kx=baseKx+lagX*slack+kiteReaction.x-linePull*15*trailX;
    const ky=baseKy+lagY*slack+kiteReaction.y-linePull*15*trailY;
    const kiteRock=kiteReaction.angle+linePull*.10;
    // 菱形的尾端朝向下风处，尾带跟着拖在风筝后面。
    const kiteAngle=kiteHeading-Math.PI*.5+Math.sin(time*.7)*.09+Math.sin(time*4.8+.7)*runWind*.24+kiteRock;
    const pose=meadowBoyPose(time,tug);
    const frontRun=activity.frontRun&&frontReady;
    const rig=meadowBoyRunningRig(activity);
    let ground;
    if(frontRun){
      const x=[-.9,8.5,12.,-1.5][activity.frontFrame],y=76+activity.bob;
      ground={line:[0,76],contacts:[[x,y,1],[x,y,0]]};
      pose.hand=[-42+activity.lean*97,-22+activity.bob];
      pose.reelHand=pose.hand.slice();
    }else if(activity.back){
      // 斜背面各帧的握线手位置，连线随转身和跑步动作一起移动。
      const grip=[[44,-23],[37,-23],[49,-25],[37,-23]][activity.frame];
      const angle=activity.running?rig.reelArm:0,c=Math.cos(angle),sn=Math.sin(angle);
      pose.hand=[(22+c*(grip[0]-22)-sn*(grip[1]+7))*activity.squeeze,
        -7+sn*(grip[0]-22)+c*(grip[1]+7)-10+activity.bob];
      pose.reelHand=pose.hand.slice();
    }else{
      pose.hand[0]*=activity.squeeze;pose.reelHand[0]*=activity.squeeze;
    }
    if(!ground)ground=meadowBoyGroundPose(activity,rig,pose);
    const state={time,position:{...position},layout:signature,routeTarget:trip?trip.to:target,
      groundY:position.y+ground.line[1]*s,kite:{x:position.x+kx*s,y:position.y+ky*s},
      ...activity,wind:runWind,runner:rig,ground,tug,linePull,kiteReaction:{...kiteReaction}};
    if(!visible)return {state};
    const kiteBounds=meadowKiteBounds(kx,ky,kiteAngle);
    const [shadowX,shadowY]=meadowKiteShadow;
    const c=Math.cos(kiteAngle),sn=Math.sin(kiteAngle);
    const attachX=kx-41*c+16*sn,attachY=ky-41*sn-16*c;
    const [handX,handY]=pose.hand;
    const regions=[
      [[-90,20,185,230],kiteBounds.map((v,i)=>v+(i%2?shadowY:shadowX))],
      [[-96,-110,116,94],kiteBounds,[Math.min(handX,attachX)-16,Math.min(handY,attachY)-2,
        Math.max(handX,attachX)+2,Math.max(handY,attachY)+20]]
    ];
    const boxes=regions.flat();
    const k=cv._scale;
    const left=Math.floor((position.x+Math.min(...boxes.map(b=>b[0]))*s)*k)-2;
    const top=Math.floor((position.y+Math.min(...boxes.map(b=>b[1]))*s)*k)-2;
    const right=Math.ceil((position.x+Math.max(...boxes.map(b=>b[2]))*s)*k)+2;
    const bottom=Math.ceil((position.y+Math.max(...boxes.map(b=>b[3]))*s)*k)+2;
    const neededWidth=right-left,neededHeight=bottom-top;
    // 只按需扩展小纹理，避免风筝摆动时每帧重分配。
    if(layerScale!==k*s||neededWidth>targetWidth||neededHeight>targetHeight){
      const sameScale=layerScale===k*s;
      layerScale=k*s;
      targetWidth=Math.max(sameScale?targetWidth:0,Math.ceil(neededWidth/64)*64);
      targetHeight=Math.max(sameScale?targetHeight:0,Math.ceil(neededHeight/64)*64);
      gl.activeTexture(gl.TEXTURE6);
      for(const layer of layers){
        gl.bindTexture(gl.TEXTURE_2D,layer);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,targetWidth,targetHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      }
    }
    const width=targetWidth,height=targetHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(0,0,width,height);
    gl.useProgram(shader.p);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,runTexture);gl.uniform1i(shader.U.uRunSprite,7);
    gl.activeTexture(gl.TEXTURE9);gl.bindTexture(gl.TEXTURE_2D,frontReady?frontRunTexture:texture);gl.uniform1i(shader.U.uFrontRunSprite,9);
    gl.uniform1i(shader.U.uCharacter,4);gl.uniform2f(shader.U.uRes,width/k,height/k);
    gl.uniform2f(shader.U.uOffset,left/k,top/k);
    gl.uniform3f(shader.U.uPlace,position.x,position.y,s);gl.uniform2f(shader.U.uKite,kx,ky);
    gl.uniform2f(shader.U.uKiteShadow,shadowX,shadowY);gl.uniform1f(shader.U.uKiteAngle,kiteAngle);
    gl.uniform4f(shader.U.uPose,pose.head,pose.nod,pose.reel,pose.pull);
    gl.uniform4f(shader.U.uMotion,activity.frame,activity.back?1:0,activity.squeeze,activity.bob);
    gl.uniform3f(shader.U.uFrontRun,frontRun?1:0,activity.frontFrame||0,activity.lean||0);
    gl.uniform4f(shader.U.uRig,activity.running?1:0,rig.arm,rig.reelArm,0);
    gl.uniform4f(shader.U.uLeftHipKnee,...rig.left.hip,...rig.left.knee);gl.uniform2f(shader.U.uLeftAnkle,...rig.left.ankle);
    gl.uniform4f(shader.U.uRightHipKnee,...rig.right.hip,...rig.right.knee);gl.uniform2f(shader.U.uRightAnkle,...rig.right.ankle);
    gl.uniform2f(shader.U.uFootAngles,rig.left.angle,rig.right.angle);
    gl.uniform2f(shader.U.uGround,...ground.line);gl.uniform3f(shader.U.uContactL,...ground.contacts[0]);gl.uniform3f(shader.U.uContactR,...ground.contacts[1]);
    gl.uniform2f(shader.U.uBody,...pose.body);gl.uniform2f(shader.U.uLegs,...pose.legs);gl.uniform2f(shader.U.uHand,...pose.hand);
    gl.uniform2f(shader.U.uTug,...pose.tugOffset);gl.uniform1f(shader.U.uTension,Math.max(linePull,activity.running?activity.gait*.62:0));gl.uniform1f(shader.U.uKiteRock,kiteRock);
    gl.uniform2f(shader.U.uReelHand,...pose.reelHand);gl.uniform1f(shader.U.uLook,pose.look);
    gl.uniform1f(shader.U.uScale,k);gl.uniform1f(shader.U.uTime,time);gl.uniform1f(shader.U.uRunWind,runWind);
    try{
      for(let i=0;i<2;i++){
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,layers[i],0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,i===1?layers[2]:null,0);
        gl.drawBuffers(i===1?[gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]:[gl.COLOR_ATTACHMENT0]);
        gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(shader.U.uShadow,i===0?1:0);
        gl.enable(gl.SCISSOR_TEST);
        // 空白处不执行人物着色器；重叠小块直接覆盖同一结果，不会叠深。
        for(const [x0,y0,x1,y1] of regions[i]){
          const l=Math.max(0,Math.floor((position.x+x0*s)*k)-left-2);
          const r=Math.min(width,Math.ceil((position.x+x1*s)*k)-left+2);
          const t=Math.max(0,Math.floor((position.y+y0*s)*k)-top-2);
          const b=Math.min(height,Math.ceil((position.y+y1*s)*k)-top+2);
          gl.scissor(l,height-b,Math.max(0,r-l),Math.max(0,b-t));
          gl.drawArrays(gl.TRIANGLES,0,3);
        }
      }
    }finally{
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,cv.width,cv.height);
    }
    return {rect:[left/k,top/k,width/k,height/k],shadow:layers[0],actor:layers[1],person:layers[2],state};
  }};
}
