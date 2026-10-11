class FocusOrb {
  constructor(element, getTimer) {
    this.element = element;
    this.canvas = element.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fragmentCanvas = document.createElement('canvas');
    this.fragmentCanvas.className = 'fragment-canvas';
    this.fragmentCanvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(this.fragmentCanvas);
    this.fragmentCtx = this.fragmentCanvas.getContext('2d');
    this.getTimer = getTimer;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.drag = null;
    this.rotation = { x: -.16, y: -.2 };
    this.target = { x: -.16, y: -.2 };
    this.size = element.getBoundingClientRect().width;
    this.faces = this.createMesh();
    this.reset();
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.drag) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-dragging');
    });
    element.addEventListener('pointermove', event => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const sensitivity = Math.PI / Math.max(this.size, 1);
      this.target.y += (event.clientX - this.drag.x) * sensitivity;
      this.target.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.target.x - (event.clientY - this.drag.y) * sensitivity));
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.request();
    });
    const release = event => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.drag = null;
      element.classList.remove('is-dragging');
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
    this.motion.addEventListener('change', () => this.request());
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('scroll', () => this.request(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      this.last = 0;
      if (!document.hidden) this.request();
    });
  }

  random(n) { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
  normalize(v) { const length = Math.hypot(...v); return v.map(n => n / length); }
  createMesh() {
    const t = (1 + Math.sqrt(5)) / 2;
    const vertices = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(v => this.normalize(v));
    let faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]].map(f => f.map(i => vertices[i]));
    for (let step = 0; step < 3; step += 1) {
      faces = faces.flatMap(([a,b,c]) => {
        const ab = this.normalize(a.map((n,i) => (n+b[i])/2));
        const bc = this.normalize(b.map((n,i) => (n+c[i])/2));
        const ca = this.normalize(c.map((n,i) => (n+a[i])/2));
        return [[a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]];
      });
    }
    return faces.map((vertices,index) => {
      const center = vertices[0].map((_,i) => vertices.reduce((s,v) => s+v[i]/3,0));
      return { vertices, center, seed: this.random(index+1), rank: (-center[1]+center[0]*.38+this.random(index+9)*.38) };
    }).sort((a,b) => a.rank-b.rank).map((face,index,array) => ({...face, threshold: (index+1)/array.length}));
  }

  reset() {
    this.time = 0;
    this.last = 0;
    this.broken = new Map();
    this.dust = [];
    this.finishedAt = null;
    this.request();
  }

  finish() {
    this.finishedAt = this.time;
    const text = document.createElement('canvas');
    text.width = 300; text.height = 100;
    const ctx = text.getContext('2d');
    const display = this.element.querySelector('h1');
    ctx.font = `450 ${parseFloat(getComputedStyle(display).fontSize) * 440 / this.size}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(display.classList.contains('has-hours') ? '00:00:00' : '00:00',150,50);
    const pixels = ctx.getImageData(0,0,300,100).data;
    for (let y = 0; y < 100; y += 4) for (let x = 0; x < 300; x += 4) {
      if (pixels[(y*300+x)*4+3] > 80) this.dust.push({x:(x-150)/440,y:(y-50)/440,seed:this.random(x*100+y)});
    }
    this.request();
  }

  rotate(v, x, y) {
    const cy = Math.cos(y), sy = Math.sin(y), cx = Math.cos(x), sx = Math.sin(x);
    const a = v[0]*cy+v[2]*sy, b = v[2]*cy-v[0]*sy;
    return [a,v[1]*cx-b*sx,v[1]*sx+b*cx];
  }

  metal(normal, seed, dark) {
    const [x,y,z] = this.normalize(normal);
    const softbox = Math.exp(-((x+.43)**2/.045+(y+.35)**2/.42));
    const strip = Math.exp(-((x-.57)**2/.008+(y+.05)**2/.65));
    const floor = Math.exp(-((y-.55)**2/.023))*Math.max(0,z);
    const rim = (1-Math.max(0,z))**3;
    const grain = Math.sin(y*940+x*12)*.8 + Math.sin(y*2130)*.35;
    const seam = Math.exp(-((y-.67)**2/.000008))*5 + Math.exp(-((y+.67)**2/.000008))*5;
    const light = 24 + softbox*215 + strip*108 + floor*42 + rim*78 + seed*2 + grain - seam;
    return [light*1.02+2,light,light*.96].map(n=> Math.round(Math.min(255,Math.max(0,dark?n:n*.88+12))));
  }

  drawFace(face, age, dark, rotation = this.rotation) {
    const flying = age !== null;
    const ctx = this.fragmentCtx, size = this.size, seed = face.seed;
    const lifetime = 4 + seed * .8;
    if (flying && age >= lifetime) return;
    const travelTime = flying ? (1 - Math.exp(-age * .45)) / .45 : 0;
    const distance = travelTime * (32 + seed * 26) / (size * .32);
    const center = this.rotate(face.center,rotation.x,rotation.y);
    const normal = this.normalize(center);
    const offset = [normal[0]*distance,normal[1]*distance+(flying?age*age*.4/(size*.32):0),normal[2]*distance*.25];
    const points = face.vertices.map(v => {
      const local = v.map((n,i)=>n-face.center[i]);
      const spun = flying ? this.rotate(local,travelTime*(seed-.35)*.9,travelTime*(seed-.6)*1.1) : local;
      const position = this.rotate(spun,rotation.x,rotation.y).map((n,i)=>n+center[i]+offset[i]);
      const perspective = 3.8/(3.8-position[2]*.22);
      return [position[0]*size*.32*perspective,position[1]*size*.32*perspective,position[2]];
    });
    const interior = !flying && center[2] < 0;
    const fade = flying ? Math.max(0,Math.min(1,(age-.8)/(lifetime-.8))) : 0;
    const alpha = flying ? 1-fade*fade*(3-2*fade) : 1;
    ctx.globalAlpha = Math.max(0,alpha);
    if (flying) {
      const thickness = size * (.006 + seed * .005) * Math.min(1,age/.25);
      for (let edge = 0; edge < 3; edge += 1) {
        const a = points[edge], b = points[(edge+1)%3];
        ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);
        ctx.lineTo(b[0]+thickness*.65,b[1]+thickness);
        ctx.lineTo(a[0]+thickness*.65,a[1]+thickness);ctx.closePath();
        ctx.fillStyle = ['#242321','#64615b','#393733'][edge];ctx.fill();
        ctx.strokeStyle = 'rgba(190,186,177,.22)';ctx.lineWidth=.45;ctx.stroke();
      }
    }
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
    const normals = face.vertices.map(v=>this.rotate(flying?this.rotate(v,travelTime*(seed-.35)*.9,travelTime*(seed-.6)*1.1):v,rotation.x,rotation.y));
    const colors = normals.map(v=>interior?this.metal(v.map(n=>-n),seed,dark).map(n=>Math.round(n*.38+8)):this.metal(v,seed,dark));
    const sorted = colors.map((c,i)=>({c,i,sum:c.reduce((a,b)=>a+b,0)})).sort((a,b)=>a.sum-b.sum);
    const low = sorted[0], high = sorted[2];
    const gradient = ctx.createLinearGradient(points[low.i][0],points[low.i][1],points[high.i][0]+.01,points[high.i][1]+.01);
    gradient.addColorStop(0,`rgb(${low.c})`);gradient.addColorStop(1,`rgb(${high.c})`);
    ctx.fillStyle=gradient;ctx.fill();
    ctx.strokeStyle=flying?'rgba(236,232,222,.65)':interior?'rgba(80,77,70,.18)':`rgba(${this.metal(center,seed,dark)},.42)`;
    ctx.lineWidth=flying?.7:.4;ctx.stroke();
    ctx.globalAlpha=1;
  }

  draw(now) {
    const timer = this.getTimer();
    const dt = this.last?Math.max(0,(now-this.last)/1000):0;
    this.last = now;
    if (timer.state !== 'paused') this.time += dt;
    const ease = this.motion.matches?1:1-Math.exp(-Math.min(dt,.1)*18);
    this.rotation.x += (this.target.x-this.rotation.x)*ease;
    this.rotation.y += (this.target.y-this.rotation.y)*ease;
    const progress = 1-timer.ratio;
    const dark = document.body.classList.contains('dark');
    const ctx = this.ctx,size=this.size;
    ctx.clearRect(0,0,size,size);
    const box = this.element.getBoundingClientRect();
    this.fragmentCtx.clearRect(0,0,this.viewportWidth,this.viewportHeight);
    this.fragmentCtx.save();
    this.fragmentCtx.translate(box.left+size/2,box.top+size*.48);
    ctx.save();ctx.translate(size/2,size*.48);
    const scene = this.fragmentCtx;
    const shadow=scene.createRadialGradient(0,size*.37,0,0,size*.37,size*.3);
    shadow.addColorStop(0,dark?'rgba(0,0,0,.7)':'rgba(40,37,32,.16)');shadow.addColorStop(1,'rgba(0,0,0,0)');
    const visible = [];
    scene.save();scene.translate(0,size*.37);scene.scale(1,.14);scene.translate(0,-size*.37);scene.fillStyle=shadow;scene.fillRect(-size/2,0,size,size);scene.restore();
    for (const face of this.faces) {
      if (progress >= face.threshold && !this.broken.has(face)) this.broken.set(face,{ time: this.time, rotation: { ...this.rotation } });
      const fragment = this.broken.get(face);
      const age=fragment?this.time-fragment.time:null;
      if (age !== null && this.motion.matches) continue;
      const rotation = fragment ? fragment.rotation : this.rotation;
      const center = this.rotate(face.center,rotation.x,rotation.y);
      const distance = age === null ? 0 : (1-Math.exp(-age*.45))/.45*(32+face.seed*26)/(size*.32);
      visible.push({face,age,rotation,depth:center[2]+this.normalize(center)[2]*distance*.25});
    }
    visible.sort((a,b)=>a.depth-b.depth);
    for (const {face,age,rotation} of visible) this.drawFace(face,age,dark,rotation);
    if (this.finishedAt !== null && !this.motion.matches) {
      const age=this.time-this.finishedAt;
      ctx.fillStyle=dark?'#e8e3d8':'#57534b';ctx.globalAlpha=Math.max(0,1-age/2);
      for (const p of this.dust) ctx.fillRect((p.x+(p.seed-.5)*age*.33)*size,(p.y+(this.random(p.seed)-.6)*age*.3+age*age*.06)*size,1.5,1.5);
      ctx.globalAlpha=1;
    }
    ctx.restore();
    this.fragmentCtx.restore();
    const moving=Math.abs(this.target.x-this.rotation.x)+Math.abs(this.target.y-this.rotation.y)>.001;
    const active=timer.state==='running'||timer.state==='completed'&&this.time-this.finishedAt<5.1||moving;
    this.frame=!this.motion.matches&&!document.hidden&&active?requestAnimationFrame(time=>this.draw(time)):0;
  }

  request() { if(!this.frame) this.frame=requestAnimationFrame(time=>this.draw(time)); }
  resize() {
    this.size=this.element.getBoundingClientRect().width;
    const dpr=Math.min(devicePixelRatio||1,2);
    this.canvas.width=Math.round(this.size*dpr);this.canvas.height=Math.round(this.size*dpr);
    this.viewportWidth = document.documentElement.clientWidth;
    this.viewportHeight = window.innerHeight;
    this.fragmentCanvas.width = Math.round(this.viewportWidth*dpr);
    this.fragmentCanvas.height = Math.round(this.viewportHeight*dpr);
    this.fragmentCtx.setTransform(dpr,0,0,dpr,0,0);
    this.ctx.setTransform(dpr,0,0,dpr,0,0);this.request();
  }
}
