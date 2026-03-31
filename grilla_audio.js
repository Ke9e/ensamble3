// ── GRILLA ENSAMBLE — Motor de Audio ─────────────────────────────────────────
// BreathCycle + SYNTH_DEFS: copia directa de sonido_lab.html (fuente de verdad)
// Patches aplicados: audioOn→try/catch, Freeverb→_mkRev, sine/lissajous setBreath

const Audio = (() => {

// ─────────────────────────────────────────────────────────────────────────────
// SYNTH_BLOCK — reemplazado en build desde sonido_lab.html
// ─────────────────────────────────────────────────────────────────────────────
// ── BreathCycle (idéntico al motor principal) ────────────────────────────
class BreathCycle {
  constructor({periodMs,silenceMs,riseSec,fallSec,minLevel,shape,rng}){
    this._period=periodMs; this._silence=silenceMs;
    this._rise=riseSec*1000; this._fall=fallSec*1000;
    this._minLevel=minLevel; this._shape=shape;
    this._rng=rng||Math.random;
    this._factor=minLevel; this._timer=null;
    this._active=false; this._phase='silent'; this._startMs=0;
  }
  get factor(){ return this._factor; }
  start(immediate=false){
    this._active=true;
    if(immediate){
      this._phase='rising';
      const backfill = this._rng() * Math.max(250, this._rise * 0.55);
      this._startMs=Date.now()-backfill;
      this._tick();
      return;
    }
    const maxOffset=this._minLevel>0?1000+this._rng()*2500:300+this._rng()*5000;
    this._timer=setTimeout(()=>this._beginRise(),maxOffset);
  }
  stop(){
    this._active=false;
    if(this._timer){clearTimeout(this._timer);this._timer=null;}
    this._factor=0; this._phase='silent';
  }
  _beginRise(){
    if(!this._active)return;
    this._phase='rising'; this._startMs=Date.now(); this._tick();
  }
  _tick(){
    if(!this._active)return;
    const now=Date.now();
    if(this._phase==='rising'){
      const t=Math.min(1,(now-this._startMs)/this._rise);
      this._factor=this._eased(t)*(1-this._minLevel)+this._minLevel;
      if(t>=1){
        this._phase='peak'; this._startMs=now;
        const peakMs=Math.max(0,this._period-this._rise-this._fall-this._silence);
        this._timer=setTimeout(()=>{this._phase='falling';this._startMs=Date.now();this._tick();},peakMs);
        return;
      }
    } else if(this._phase==='falling'){
      const t=Math.min(1,(now-this._startMs)/this._fall);
      this._factor=(1-this._eased(t))*(1-this._minLevel)+this._minLevel;
      if(t>=1){
        this._factor=this._minLevel; this._phase='silent';
        const jitter=(this._rng()-0.5)*this._silence*0.4;
        this._timer=setTimeout(()=>this._beginRise(),Math.max(200,this._silence+jitter));
        return;
      }
    }
    this._timer=setTimeout(()=>this._tick(),30);
  }
  _eased(t){
    if(this._shape==='erratic') return t+Math.sin(t*Math.PI*3)*0.08*(1-t);
    if(this._shape==='pulse')   return t<0.15?t/0.15:1-((t-0.15)/0.85)*0.3;
    return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  }
}

// ── Sintetizadores (copiados del motor principal) ────────────────────────
  // ── Freeverb helper — fallback bypass si falla (file:// protocol) ───────
  function _mkRev(opts) {
    try { return new Tone.Freeverb(opts); }
    catch(e) { return new Tone.Gain(1); }
  }


const SYNTH_DEFS = {

  bezier: (dest) => {
    // Pool de 4 voces — permite superponer gongs sin cortar el decay
    const POOL_SIZE = 4;
    const rev = _mkRev({roomSize:0.97, wet:0.70});
    rev.connect(dest);

    const mkVoice = () => {
      const gT  = new Tone.Gain(2.5);
      const sT  = new Tone.FMSynth({harmonicity:5.8,modulationIndex:22,
                    envelope:{attack:0.001,decay:0.10,sustain:0.0,release:0.08},
                    modulationEnvelope:{attack:0.001,decay:0.05,sustain:0.0,release:0.03},volume:-4});
      sT.chain(gT, rev);

      const gB  = new Tone.Gain(2.0);
      const envB= new Tone.AmplitudeEnvelope({attack:0.01,decay:4.5,sustain:0.0,release:2.0});
      const oscB= new Tone.Oscillator({type:'sine',frequency:55});
      oscB.chain(envB, gB, rev);

      const gR  = new Tone.Gain(1.4);
      const lfoR= new Tone.LFO({frequency:0.6,min:-4,max:4}).start();
      const sR  = new Tone.FMSynth({harmonicity:2.76,modulationIndex:8,
                    envelope:{attack:0.05,decay:8.0,sustain:0.0,release:3.0},
                    modulationEnvelope:{attack:0.05,decay:4.0,sustain:0.0,release:2.0},volume:-10});
      lfoR.connect(sR.detune);
      sR.chain(gR, rev);

      oscB.start();
      return { sT, oscB, envB, sR, lfoR, gT, gB, gR,
               nodes:[gT,sT,gB,envB,oscB,gR,lfoR,sR],
               lastUsed: 0 };
    };

    const pool = Array.from({length:POOL_SIZE}, mkVoice);
    const allNodes = [rev, ...pool.flatMap(v=>v.nodes)];

    const GONG_FREQS = [41,46,55,55,62,62,73];
    let _lastFreq = 55, _distAcc = 0, _stepLen = 350;

    // Toma la voz menos usada recientemente (round-robin por lastUsed)
    const nextVoice = () => pool.reduce((a,b) => a.lastUsed < b.lastUsed ? a : b);

    const strike = (freq, vel) => {
      const v   = nextVoice();
      v.lastUsed = performance.now();
      const now  = Tone.now();
      try{ v.sT.triggerAttackRelease(freq*2.5,'16n',now,vel); }catch(e){}
      try{ v.oscB.frequency.setValueAtTime(freq,now); v.envB.triggerAttackRelease(4.5,now,vel*0.9); }catch(e){}
      try{ v.sR.triggerAttackRelease(freq*1.38,'1n',now,vel*0.6); }catch(e){}
    };

    return {
      nodes: allNodes, _isPerc: true,
      setFreq:(f)=>{ const idx=Math.floor((f/880)*(GONG_FREQS.length-1)); _lastFreq=GONG_FREQS[Math.min(idx,GONG_FREQS.length-1)]; },
      setInterval:(px)=>{ _stepLen=Math.max(px*0.6,300); },
      triggerAt:(vel)=>{ strike(_lastFreq, vel||0.7); },
      tickDist:(d)=>{ _distAcc+=d; if(_distAcc>=_stepLen){ _distAcc-=_stepLen; strike(_lastFreq,0.5+Math.random()*0.5); } },
      start:()=>{},
      stop:()=>{ pool.forEach(v=>{ try{v.oscB.stop();}catch(e){} try{v.sT.triggerRelease();}catch(e){} try{v.sR.triggerRelease();}catch(e){} }); },
    };
  },

  sine: (dest) => {
    const masterG = new Tone.Gain(0.0);
    masterG.connect(dest);

    const baseFreq = 130;
    const oscA = new Tone.Oscillator({ type:'sine', frequency: baseFreq });
    const oscB = new Tone.Oscillator({ type:'sine', frequency: baseFreq });
    const gA = new Tone.Gain(0.5); oscA.connect(gA); gA.connect(masterG);
    const gB = new Tone.Gain(0.5); oscB.connect(gB); gB.connect(masterG);
    const breathLFO = new Tone.LFO({ frequency: 0.055, min: 0.6, max: 1.0 }).start();
    breathLFO.connect(gA.gain);

    let beatHz = 0.4;
    const updateBeating = () => {
      oscB.frequency.rampTo(baseFreq + beatHz, 0.8);
    };

    return {nodes:[masterG,oscA,oscB,gA,gB,breathLFO],_isGlue:true,
      setFreq:()=>{},
      setCurv:()=>{},
      setBreath:(bf)=>{masterG.gain.rampTo(bf * 0.09, 1.2);},
      setVel:()=>{},
      tickDist:()=>{},
      _setPos:(xNorm)=>{
        const dist = Math.abs(xNorm - 0.5) * 2;
        beatHz = 0.2 + dist * 2.8;
        updateBeating();
      },
      start:()=>{oscA.start(); oscB.start(); updateBeating();},
      stop:()=>{masterG.gain.rampTo(0,2.0);setTimeout(()=>{try{oscA.stop();oscB.stop();}catch(e){}},2200);},
    };
  },

  arc: (dest) => {
    const rev=_mkRev({roomSize:0.94,wet:0.65});
    const gain=new Tone.Gain(1.8);
    const mkBell=(harm,modIdx)=>new Tone.FMSynth({harmonicity:harm,modulationIndex:modIdx,envelope:{attack:0.001,decay:2.8,sustain:0.0,release:1.5},modulationEnvelope:{attack:0.001,decay:1.2,sustain:0.0,release:0.8},oscillator:{type:'sine'},modulation:{type:'sine'},volume:-8});
    const bellA=mkBell(3.0,14),bellB=mkBell(4.1,10),bellC=mkBell(2.4,18);

    // ── Cadena del acorde especial — Cuenco tibetano ────────────────────────
    // Arquitectura: tres sines puros con ataque lento + beating natural entre voces
    //   bowlA/B/C → bowlRev → chordBus → dest
    // Sin FM, sin modulación digital — solo sine, envelope lento, reverb largo

    const chordBus = new Tone.Gain(0.9);
    const bowlRev  = _mkRev({roomSize:0.96, dampening:3500, wet:0.75});
    chordBus.chain(bowlRev, dest);

    // Tres osciladores sine — el beating entre ellos es el "cuenco"
    // bowlA: raíz exacta
    // bowlB: quinta abajo (×0.667) + 1.5 cents de detuning → beating lento ~0.5Hz
    // bowlC: octava abajo (×0.5) + 0.8 cents → beating muy lento ~0.2Hz
    const mkBowl = () => {
      const osc = new Tone.Oscillator({type:'sine'});
      const env = new Tone.AmplitudeEnvelope({
        attack: 0.14,   // abre despacio
        decay:  14.0,   // decay muy lento — se mezcla con el resto
        sustain:0.0,
        release:8.0,
      });
      const g = new Tone.Gain(0.0);
      osc.chain(env, g, chordBus);
      osc.start();
      return {osc, env, g};
    };
    const bowlA = mkBowl(); // raíz
    const bowlB = mkBowl(); // quinta abajo
    const bowlC = mkBowl(); // octava abajo

    // LFO de amplitud muy lento — hace que el cuenco "respire" después del ataque
    const bowlBreathA = new Tone.LFO({frequency:0.07, min:0.85, max:1.0}).start();
    const bowlBreathB = new Tone.LFO({frequency:0.05, min:0.80, max:1.0}).start();
    const bowlBreathC = new Tone.LFO({frequency:0.09, min:0.82, max:1.0}).start();
    // Los LFOs modulan el gain de salida de cada bowl (cuando están activos)
    // — se conectan dinámicamente en triggerChord

    // Chorus del triggerAt (notas normales) — se mantiene
    const chorusA = new Tone.Oscillator({type:'sine', frequency:220});
    const chorusB = new Tone.Oscillator({type:'sine', frequency:220});
    const chorusEnvA = new Tone.AmplitudeEnvelope({attack:0.006,decay:3.5,sustain:0.0,release:2.2});
    const chorusEnvB = new Tone.AmplitudeEnvelope({attack:0.010,decay:3.5,sustain:0.0,release:2.2});
    const chorusGainA = new Tone.Gain(0.0);
    const chorusGainB = new Tone.Gain(0.0);
    const chorusLFO = new Tone.LFO({frequency:0.18, min:-6, max:6}).start();
    chorusLFO.connect(chorusB.detune);
    chorusA.chain(chorusEnvA, chorusGainA, chordBus);
    chorusB.chain(chorusEnvB, chorusGainB, chordBus);
    chorusA.start(); chorusB.start();

    // Shimmer — se mantiene para el triggerAt
    const shimmerOsc  = new Tone.Oscillator({type:'sine', frequency:440});
    const shimmerEnv  = new Tone.AmplitudeEnvelope({attack:0.18, decay:6.0, sustain:0.0, release:4.0});
    const shimmerRev  = _mkRev({roomSize:0.98, dampening:4000, wet:1.0});
    const shimmerGain = new Tone.Gain(0.0);
    const shimmerLFO  = new Tone.LFO({frequency:3.2, min:-2, max:2}).start();
    shimmerLFO.connect(shimmerOsc.detune);
    shimmerOsc.chain(shimmerEnv, shimmerRev, shimmerGain, chordBus);
    shimmerOsc.start();

    // Campanas del patrón normal
    [bellA,bellB,bellC].forEach(b=>b.chain(gain,rev,dest));

    const PAT=[[0,196,1.0],[null,0,0],[null,0,0],[1,261,0.7],[null,0,0],[2,329,0.9],[null,0,0],[null,0,0],[0,392,0.6],[null,0,0],[1,220,0.8],[null,0,0],[2,261,1.0],[null,0,0],[null,0,0],[0,329,0.7]];
    const bells=[bellA,bellB,bellC];
    let _step=0,_distAcc=0,_stepLen=140;

    const allChordNodes = [chordBus,bowlRev,
      bowlA.osc,bowlA.env,bowlA.g,
      bowlB.osc,bowlB.env,bowlB.g,
      bowlC.osc,bowlC.env,bowlC.g,
      bowlBreathA,bowlBreathB,bowlBreathC,
      chorusA,chorusB,chorusEnvA,chorusEnvB,
      chorusGainA,chorusGainB,chorusLFO,
      shimmerOsc,shimmerEnv,shimmerRev,shimmerGain,shimmerLFO];

    return {nodes:[rev,gain,bellA,bellB,bellC,...allChordNodes],_isPerc:true,
      setFreq:()=>{},
      setInterval:(px)=>{_stepLen=Math.max(px/8,100);},
      triggerAt:(vel, baseFreq)=>{
        let tries=0, noteFreq=220;
        while(tries < PAT.length){
          const[bIdx,freq,bVel]=PAT[_step%PAT.length]; _step++; tries++;
          if(bIdx!==null && freq>0){
            noteFreq = freq;
            try{bells[bIdx].triggerAttackRelease(freq,'2n',Tone.now(),(vel||1)*bVel);}catch(e){}
            break;
          }
        }
        // Chorus sutil en todas las notas — presencia menor que en el acorde
        const now = Tone.now();
        const v   = vel || 0.7;
        chorusA.frequency.setValueAtTime(noteFreq * 0.9976, now);
        chorusB.frequency.setValueAtTime(noteFreq * 1.0024, now);
        chorusGainA.gain.setValueAtTime(v * 0.18, now);
        chorusGainB.gain.setValueAtTime(v * 0.18, now);
        try{ chorusEnvA.triggerAttackRelease('2n', now); }catch(e){}
        try{ chorusEnvB.triggerAttackRelease('2n', now + 0.015); }catch(e){}
        chorusGainA.gain.setValueAtTime(0, now + 3.0);
        chorusGainB.gain.setValueAtTime(0, now + 3.0);
        // Shimmer tenue — entra más tarde, más corto, más suave
        shimmerOsc.frequency.setValueAtTime(noteFreq * 2.0, now);
        shimmerGain.gain.setValueAtTime(v * 0.12, now);
        try{ shimmerEnv.triggerAttackRelease('4n', now + 0.12); }catch(e){}
        shimmerGain.gain.linearRampToValueAtTime(0, now + 4.5);
      },
      triggerChord:(freq, vel)=>{
        const now = Tone.now();
        const v   = vel || 0.8;

        // ── Cuenco tibetano — una octava más grave, decay largo ──
        // Todo baja ×0.5 respecto a la frecuencia del punto
        // → grave, se funde con el reverb del sistema

        // Raíz — una octava abajo
        bowlA.osc.frequency.setValueAtTime(freq * 0.5, now);
        bowlA.g.gain.cancelScheduledValues(now);
        bowlA.g.gain.setValueAtTime(v * 0.88, now);
        try{ bowlA.env.triggerAttackRelease('1m', now); }catch(e){}

        // Quinta abajo de la octava baja + micro-detuning → beating ~0.5Hz
        bowlB.osc.frequency.setValueAtTime(freq * 0.5 * 0.667 * 1.00087, now + 0.07);
        bowlB.g.gain.cancelScheduledValues(now);
        bowlB.g.gain.setValueAtTime(v * 0.72, now + 0.07);
        try{ bowlB.env.triggerAttackRelease('1m', now + 0.07); }catch(e){}

        // Dos octavas abajo + micro-detuning → sub, muy lento
        bowlC.osc.frequency.setValueAtTime(freq * 0.25 * 1.00046, now + 0.16);
        bowlC.g.gain.cancelScheduledValues(now);
        bowlC.g.gain.setValueAtTime(v * 0.55, now + 0.16);
        try{ bowlC.env.triggerAttackRelease('1m', now + 0.16); }catch(e){}

        // El decay del envelope ya es 14s — el fade lo refuerza
        bowlA.g.gain.linearRampToValueAtTime(0, now + 16.0);
        bowlB.g.gain.linearRampToValueAtTime(0, now + 16.0);
        bowlC.g.gain.linearRampToValueAtTime(0, now + 16.0);
      },
      // Escala: do → mi (+4 semitonos) → re (+2) — subida y retorno
      // ti — tun — tan: nota raíz, nota alta, nota media
      // Cada nota usa una campana distinta del pool normal
      triggerScale:(freq, vel)=>{
        const now = Tone.now();
        const v   = vel || 0.75;
        const GAP = 0.6; // 600ms entre notas
        // Escala pentatónica: do(raíz) → mi(×1.26) → re(×1.12)
        // Usando las tres campanas del patrón para timbre consistente
        try{ bellA.triggerAttackRelease(freq,        '2n', now,          v * 1.0); }catch(e){}
        try{ bellB.triggerAttackRelease(freq * 1.26, '2n', now + GAP,    v * 0.85); }catch(e){}
        try{ bellC.triggerAttackRelease(freq * 1.12, '2n', now + GAP*2,  v * 0.70); }catch(e){}
      },
      tickDist:(d)=>{_distAcc+=d;if(_distAcc>=_stepLen){_distAcc-=_stepLen;const[bIdx,freq,vel]=PAT[_step%PAT.length];_step++;if(bIdx!==null&&freq>0){try{bells[bIdx].triggerAttackRelease(freq,'2n',Tone.now(),vel);}catch(e){}}}},
      start:()=>{},
      stop:()=>{
        bells.forEach(b=>{try{b.triggerRelease();}catch(e){}});
        [bowlA,bowlB,bowlC].forEach(b=>{try{b.env.triggerRelease();}catch(e){}});
        try{chorusEnvA.triggerRelease();chorusEnvB.triggerRelease();}catch(e){}
        try{shimmerEnv.triggerRelease();}catch(e){}
      },
    };
  },

  angular: (dest) => {
    // ── Metal / vidrio — lógica percusiva ────────────────────────────────────
    // Pool de 3 voces: sine agudo + armónico + breath noise
    // X del viajero → frecuencia base (rango agudo 1800–4800Hz)
    const rev = _mkRev({roomSize:0.98, dampening:1500, wet:0.95});
    rev.connect(dest);

    const mkVoice = () => {
      const g    = new Tone.Gain(0.0);
      // Fundamental — sine agudo, decay medio
      const oscF = new Tone.Oscillator({type:'sine', frequency:2400});
      const envF = new Tone.AmplitudeEnvelope({attack:0.001, decay:2.8, sustain:0.0, release:1.5});
      const gF   = new Tone.Gain(0.75);
      // Armónico — cuarta octava, más suave, más largo
      const oscH = new Tone.Oscillator({type:'sine', frequency:9600});
      const envH = new Tone.AmplitudeEnvelope({attack:0.002, decay:5.0, sustain:0.0, release:2.5});
      const gH   = new Tone.Gain(0.15);
      // Breath transient — ruido blanco filtrado, muy corto (ataque del golpe)
      const noise = new Tone.Noise('white');
      const filt  = new Tone.Filter({frequency:5500, type:'bandpass', Q:30});
      const envN  = new Tone.AmplitudeEnvelope({attack:0.001, decay:0.08, sustain:0.0, release:0.04});
      const gN    = new Tone.Gain(0.35);
      oscF.chain(gF, envF, g, rev);
      oscH.chain(gH, envH, g, rev);
      noise.chain(filt, envN, gN, g, rev);
      oscF.start(); oscH.start(); noise.start();
      return {g, oscF, envF, gF, oscH, envH, gH, noise, filt, envN, gN, lastUsed:0};
    };

    const POOL_SIZE = 3;
    const pool = Array.from({length:POOL_SIZE}, mkVoice);
    let poolIdx = 0;
    const nextVoice = () => { const v=pool[poolIdx]; poolIdx=(poolIdx+1)%POOL_SIZE; return v; };

    let _lastFreq = 2400;

    // Tabla de multiplicadores de registro — mezcla grave, medio y agudo
    // Cada golpe elige uno al azar para que haya variedad tímbrica
    const REGISTERS = [
      {mul:1.0,  harmMul:2.0,  decayF:4.5, decayH:7.0, vol:0.95}, // grave — fundamental directa
      {mul:2.0,  harmMul:3.0,  decayF:3.5, decayH:5.5, vol:0.88}, // medio-grave
      {mul:4.5,  harmMul:4.0,  decayF:2.8, decayH:5.0, vol:0.85}, // medio-agudo (original)
      {mul:8.0,  harmMul:3.5,  decayF:1.8, decayH:3.5, vol:0.75}, // agudo — cristal
      {mul:12.0, harmMul:2.8,  decayF:1.2, decayH:2.5, vol:0.65}, // muy agudo — fino
    ];

    const strike = (freq, vel) => {
      const now = Tone.now();
      const v   = nextVoice();
      const reg = REGISTERS[Math.floor(Math.random() * REGISTERS.length)];
      const f   = freq * reg.mul;
      v.oscF.frequency.setValueAtTime(f,              now);
      v.oscH.frequency.setValueAtTime(f * reg.harmMul, now);
      v.filt.frequency.setValueAtTime(f * 2.0,        now);
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(vel * reg.vol, now);
      try{ v.envF.triggerAttackRelease(reg.decayF + 's', now,        vel);       }catch(e){}
      try{ v.envH.triggerAttackRelease(reg.decayH + 's', now + 0.01, vel * 0.4); }catch(e){}
      try{ v.envN.triggerAttackRelease('64n',             now,        vel);       }catch(e){}
      v.g.gain.linearRampToValueAtTime(0, now + reg.decayH + 2.0);
    };

    const allNodes = [...pool.flatMap(v=>[v.g,v.oscF,v.envF,v.gF,v.oscH,v.envH,v.gH,v.noise,v.filt,v.envN,v.gN]), rev];

    return {nodes:allNodes, _isPerc:true,
      setFreq:(f)=>{ _lastFreq=f; },
      setInterval:()=>{},
      triggerAt:(vel)=>{
        const f   = _lastFreq;
        const v   = vel || 0.8;
        const GAP = 0.6;
        // Escala ti-tun-tan: raíz → nota alta (×1.26) → nota media (×1.12)
        // Cada nota elige su propio registro al azar — así las tres suenan distintas
        strike(f,        v * 1.0);
        setTimeout(()=>{ try{ strike(f * 1.26, v * 0.82); }catch(e){} }, GAP * 1000);
        setTimeout(()=>{ try{ strike(f * 1.12, v * 0.65); }catch(e){} }, GAP * 2000);
      },
      tickDist:()=>{},
      start:()=>{},
      stop:()=>{ pool.forEach(v=>{ try{v.envF.triggerRelease();v.envH.triggerRelease();v.envN.triggerRelease();}catch(e){} }); },
    };
  },

  spiral: (dest) => {
    const masterG = new Tone.Gain(0.0);
    masterG.connect(dest);

    const baseFreq = 80;
    const osc0 = new Tone.Oscillator({ type:'sine', frequency: baseFreq });
    const g0   = new Tone.Gain(0.0); osc0.connect(g0); g0.connect(masterG);
    const osc1 = new Tone.Oscillator({ type:'sine', frequency: baseFreq * 1.5 });
    const g1   = new Tone.Gain(0.0); osc1.connect(g1); g1.connect(masterG);
    const osc2 = new Tone.Oscillator({ type:'triangle', frequency: baseFreq * 2 });
    const g2   = new Tone.Gain(0.0); osc2.connect(g2); g2.connect(masterG);
    const osc3a = new Tone.Oscillator({ type:'sawtooth', frequency: baseFreq * 3.01 });
    const osc3b = new Tone.Oscillator({ type:'sawtooth', frequency: baseFreq * 2.99 });
    const g3    = new Tone.Gain(0.0);
    osc3a.connect(g3); osc3b.connect(g3); g3.connect(masterG);
    const driftLFO = new Tone.LFO({ frequency: 0.17, min:-12, max:12 }).start();
    driftLFO.connect(osc3a.detune);
    const breathLFO = new Tone.LFO({ frequency: 0.04, min: 0.75, max: 1.0 }).start();
    breathLFO.connect(g0.gain);

    return {nodes:[masterG,osc0,osc1,osc2,osc3a,osc3b,g0,g1,g2,g3,driftLFO,breathLFO],_isGlue:true,
      setFreq:()=>{},
      setCurv:()=>{},
      setBreath:(bf)=>{masterG.gain.rampTo(bf * 0.18, 1.0);},
      setVel:()=>{},
      tickDist:()=>{},
      _setRad:(rad)=>{
        const ramp = 0.6;
        g0.gain.rampTo(0.40, ramp);
        g1.gain.rampTo(rad > 0.25 ? (rad - 0.25) / 0.75 * 0.32 : 0, ramp);
        g2.gain.rampTo(rad > 0.50 ? (rad - 0.50) / 0.50 * 0.24 : 0, ramp);
        g3.gain.rampTo(rad > 0.75 ? (rad - 0.75) / 0.25 * 0.18 : 0, ramp);
      },
      start:()=>{osc0.start(); osc1.start(); osc2.start(); osc3a.start(); osc3b.start();},
      stop:()=>{masterG.gain.rampTo(0,2.0);setTimeout(()=>{try{osc0.stop();osc1.stop();osc2.stop();osc3a.stop();osc3b.stop();}catch(e){}},2200);},
    };
  },

  catenary: (dest) => {
    const gainNode=new Tone.Gain(0.0);
    const filter=new Tone.Filter({frequency:280,type:'bandpass',Q:18});
    const lfoFilt=new Tone.LFO({frequency:0.04,min:120,max:520}).start();
    const noise=new Tone.Noise('pink');
    lfoFilt.connect(filter.frequency);
    noise.chain(filter,gainNode,dest);
    return {nodes:[filter,lfoFilt,gainNode,noise],_isGlue:true,
      setFreq:()=>{},
      setCurv:(k)=>{const inv=1-k;gainNode.gain.rampTo(inv*0.11+0.02,0.6);},
      setBreath:(bf)=>{gainNode.gain.rampTo(Math.max(gainNode.gain.value,bf*0.18),0.8);},
      setVel:()=>{},
      start:()=>{noise.start();},
      stop:()=>{gainNode.gain.rampTo(0,2.0);setTimeout(()=>{try{noise.stop();}catch(e){}},2100);},
    };
  },

  clothoid: (dest) => {
    // ── Roce sobre madera — textura continua ─────────────────────────────────
    const masterG = new Tone.Gain(1.0);
    masterG.connect(dest);
    const mkLayer = (noiseType, freq, Q, decayS, vol) => {
      const noise = new Tone.Noise(noiseType);
      const filt  = new Tone.Filter({type:'bandpass', frequency:freq, Q:Q});
      const env   = new Tone.AmplitudeEnvelope({
        attack: 0.002, decay: decayS, sustain: 0.0, release: decayS * 0.5
      });
      const g = new Tone.Gain(vol);
      noise.chain(filt, env, g, masterG);
      noise.start();
      let acc = 0;
      return {
        nodes: [noise, filt, env, g],
        stop: () => { try{ noise.stop(); }catch(e){} },
        tick: (d, interval, bf) => {
          acc += d;
          if(acc >= interval){
            acc -= interval;
            const vel = (0.4 + Math.random() * 0.6) * bf;
            try{ env.triggerAttackRelease(decayS, Tone.now(), vel); }catch(e){}
          }
        }
      };
    };
    const layA = mkLayer('brown', 180, 14, 0.055, 1.6);
    const layB = mkLayer('pink', 620, 18, 0.035, 1.2);
    const layC = mkLayer('white', 3200, 22, 0.018, 0.5);
    const INT_A = 38, INT_B = 22, INT_C = 14;
    let bf = 0, curv = 0;
    return {
      nodes:[...layA.nodes, ...layB.nodes, ...layC.nodes, masterG],
      _isGlue:true,
      setFreq:()=>{},
      setCurv:(k)=>{ curv = k; },
      setBreath:(nextBf)=>{ bf = nextBf; masterG.gain.rampTo(nextBf * 1.1, 0.4); },
      setVel:()=>{},
      tickDist:(d)=>{
        if(bf < 0.02) return;
        const density = 1.0 - curv * 0.55;
        layA.tick(d, INT_A * density + Math.random() * 12, bf);
        layB.tick(d, INT_B * density + Math.random() * 8, bf);
        layC.tick(d, INT_C * density + Math.random() * 6, bf);
      },
      start:()=>{},
      stop:()=>{
        masterG.gain.rampTo(0, 0.8);
        setTimeout(()=>{ layA.stop(); layB.stop(); layC.stop(); }, 900);
      },
    };

    // Capa A — cuerpo grave (ruido marrón filtrado 140Hz)
    const noiseA = new Tone.Noise('brown');
    const filtA  = new Tone.Filter({type:'bandpass', frequency:140, Q:6});
    const gainA  = new Tone.Gain(0.0);
    noiseA.chain(filtA, gainA, masterG);

    // Capa B — superficie media (ruido rosa 580Hz)
    const noiseB = new Tone.Noise('pink');
    const filtB  = new Tone.Filter({type:'bandpass', frequency:580, Q:4});
    const gainB  = new Tone.Gain(0.0);
    noiseB.chain(filtB, gainB, masterG);

    // Capa C — aire y aspereza (ruido blanco 2800Hz)
    const noiseC = new Tone.Noise('white');
    const filtC  = new Tone.Filter({type:'bandpass', frequency:2800, Q:3});
    const gainC  = new Tone.Gain(0.0);
    noiseC.chain(filtC, gainC, masterG);

    // LFOs de movimiento — modulan las frecuencias de los filtros
    const lfoA = new Tone.LFO({frequency:0.11, min:90,   max:200  }).start();
    const lfoB = new Tone.LFO({frequency:0.07, min:380,  max:820  }).start();
    const lfoC = new Tone.LFO({frequency:0.19, min:2000, max:4200 }).start();
    lfoA.connect(filtA.frequency);
    lfoB.connect(filtB.frequency);
    lfoC.connect(filtC.frequency);

    let _vel=0, _curv=0, _bf=0;

    const updateGains = () => {
      const i = Math.max(0, _vel * 0.8 + _curv * 0.2) * _bf;
      gainA.gain.rampTo(i * 1.8,  0.15);
      gainB.gain.rampTo(i * 1.4,  0.12);
      gainC.gain.rampTo(i * 0.35, 0.10);
    };

    return {nodes:[masterG,rev,noiseA,filtA,gainA,noiseB,filtB,gainB,noiseC,filtC,gainC,lfoA,lfoB,lfoC],_isGlue:true,
      setFreq:(f)=>{
        filtA.frequency.rampTo(Math.max(60,  f * 0.25), 0.5);
        filtB.frequency.rampTo(Math.max(300, f * 1.1),  0.5);
      },
      setCurv:(k)=>{ _curv=k; updateGains(); },
      setBreath:(bf)=>{ _bf=bf; masterG.gain.rampTo(bf * 0.9, 0.6); updateGains(); },
      setVel:(spd)=>{ _vel=Math.min(1, spd * 1.2); updateGains(); },
      tickDist:()=>{},
      start:()=>{ noiseA.start(); noiseB.start(); noiseC.start(); },
      stop:()=>{
        masterG.gain.rampTo(0, 1.8);
        setTimeout(()=>{ try{noiseA.stop();noiseB.stop();noiseC.stop();}catch(e){} }, 2000);
      },
    };
  },

  irregular: (dest) => {
    // ── Pool de 3 voces por capa — round-robin, nunca se cortan ──
    const mkFM=(harm,modIdx,decayT,vol)=>{
      const g=new Tone.Gain(vol);
      const s=new Tone.FMSynth({harmonicity:harm,modulationIndex:modIdx,volume:0,
        envelope:{attack:0.001,decay:decayT,sustain:0.02,release:decayT*0.6},
        modulationEnvelope:{attack:0.001,decay:decayT*0.3,sustain:0,release:0.05}});
      s.chain(g,dest); return{s,g,lastUsed:0};
    };
    const mkPool=(harm,modIdx,decayT,vol,n=3)=>{
      const voices = Array.from({length:n}, ()=>mkFM(harm,modIdx,decayT,vol));
      let idx=0;
      return {
        voices,
        next(){ const v=voices[idx]; idx=(idx+1)%n; return v; }
      };
    };
    const poolA = mkPool(1.5, 4,  0.55, 2.8);
    const poolB = mkPool(2.8, 7,  0.28, 2.2);
    const poolC = mkPool(4.2, 12, 0.12, 1.8);

    const PAT_A=[[90,1.0],[0,0],[0,0],[110,0.7],[0,0],[90,0.9],[0,0]];
    const PAT_B=[[220,0.8],[0,0],[180,0.6],[220,0.9],[0,0],[200,0.5],[0,0],[220,1.0],[0,0],[180,0.7],[0,0]];
    const PAT_C=[[320,0.9],[280,0.5],[0,0],[340,0.8],[300,0.6]];
    let _stepA=0,_stepB=0,_stepC=0,_accA=0,_accB=0,_accC=0,_lenA=90,_lenB=55,_lenC=32;

    const trigger=(pool,pat,stepRef,vel)=>{
      const[freq,v]=pat[stepRef%pat.length];
      if(freq>0&&v>0){
        const voice = pool.next();
        try{voice.g.gain.cancelScheduledValues(Tone.now());
            voice.g.gain.setValueAtTime(v*vel,Tone.now());
            voice.s.triggerAttackRelease(freq,'16n',Tone.now(),v);}catch(e){}
      }
    };

    // ── Eco especial: FeedbackDelay → dos BandPass resonantes en paralelo ──
    // Cadena: poolAeco → ecoDelay → [bp1, bp2] → ecoOut → dest
    const ecoDelay = new Tone.FeedbackDelay({delayTime:'8n', feedback:0.90, wet:0.0});
    const ecoOut   = new Tone.Gain(0.0); // master del eco, se activa en triggerChord
    ecoOut.connect(dest);

    // BP1 — cavidad baja (~180Hz, Q:8) — más ancho, más señal pasa
    const bp1 = new Tone.Filter({type:'bandpass', frequency:180, Q:8});
    // BP2 — cavidad media-alta (~620Hz, Q:6) — más ancho, más presencia
    const bp2 = new Tone.Filter({type:'bandpass', frequency:620, Q:6});
    // Los dos BP en paralelo desde el delay → ecoOut
    ecoDelay.connect(bp1); bp1.connect(ecoOut);
    ecoDelay.connect(bp2); bp2.connect(ecoOut);

    const poolAeco = mkPool(1.5, 4, 0.55, 2.8, 2);
    poolAeco.voices.forEach(v => { v.s.disconnect(); v.s.chain(v.g, ecoDelay); });

    const allNodes = [ecoDelay, ecoOut, bp1, bp2,
      ...poolA.voices.flatMap(v=>[v.s,v.g]),
      ...poolB.voices.flatMap(v=>[v.s,v.g]),
      ...poolC.voices.flatMap(v=>[v.s,v.g]),
      ...poolAeco.voices.flatMap(v=>[v.s,v.g]),
    ];

    return {nodes:allNodes, _isPerc:true,
      setFreq:()=>{},
      setInterval:(px)=>{_lenA=Math.max(px/8,60);_lenB=Math.max(px/13,38);_lenC=Math.max(px/22,22);},
      triggerAt:(vel)=>{
        trigger(poolA,PAT_A,_stepA++,(vel||1)*2.8);
        if(Math.random()<0.7) trigger(poolB,PAT_B,_stepB++,(vel||1)*2.2);
        if(Math.random()<0.4) trigger(poolC,PAT_C,_stepC++,(vel||1)*1.8);
      },
      triggerChord:(freq, vel)=>{
        const now = Tone.now();
        const v = vel || 0.9;
        // Eco + resonadores activos solo durante este evento
        ecoDelay.wet.cancelScheduledValues(now);
        ecoDelay.wet.setValueAtTime(1.0, now);
        ecoDelay.wet.linearRampToValueAtTime(0.0, now + 3.5);
        ecoOut.gain.cancelScheduledValues(now);
        ecoOut.gain.setValueAtTime(4.0, now);   // más presencia
        ecoOut.gain.linearRampToValueAtTime(0.0, now + 3.5);
        // Capa A con eco (voz del pool especial)
        const [fA, vA] = PAT_A[_stepA % PAT_A.length]; _stepA++;
        if(fA > 0){
          const voice = poolAeco.next();
          try{ voice.g.gain.cancelScheduledValues(now);
               voice.g.gain.setValueAtTime(v*2.8, now);
               voice.s.triggerAttackRelease(fA,'16n',now,vA); }catch(e){}
        }
        trigger(poolB,PAT_B,_stepB++,v*2.2);
        if(Math.random()<0.6) trigger(poolC,PAT_C,_stepC++,v*1.8);
      },
      tickDist:(d)=>{
        _accA+=d;_accB+=d;_accC+=d;
        if(_accA>=_lenA){_accA-=_lenA;trigger(poolA,PAT_A,_stepA++,2.8);}
        if(_accB>=_lenB){_accB-=_lenB;trigger(poolB,PAT_B,_stepB++,2.2);}
        if(_accC>=_lenC){_accC-=_lenC;trigger(poolC,PAT_C,_stepC++,1.8);}
      },
      start:()=>{},stop:()=>{},
    };
  },

  lissajous: (dest) => {
    const gainNode=new Tone.Gain(0.0); gainNode.connect(dest);
    const lfoDetune=new Tone.LFO({frequency:0.035,min:1.8,max:5.5}).start();
    const oscA=new Tone.Oscillator({type:'sine',frequency:220});
    const oscB=new Tone.Oscillator({type:'sine',frequency:223.5});
    lfoDetune.connect(oscB.detune);
    oscA.connect(gainNode); oscB.connect(gainNode);
    let breathFactor = 1.0;
    return {nodes:[gainNode,lfoDetune,oscA,oscB],_isGlue:true,
      setFreq:(f)=>{oscA.frequency.rampTo(f,0.6);oscB.frequency.rampTo(f*1.008,0.6);},
      setCurv:(k)=>{
        const body = 0.035 + k * 0.26;
        gainNode.gain.rampTo(body * (0.55 + breathFactor * 0.45), 0.5);
      },
      setBreath:(bf)=>{ breathFactor = Math.max(0, Math.min(1, bf)); },
      setVel:()=>{},
      start:()=>{oscA.start();oscB.start();},
      stop:()=>{gainNode.gain.rampTo(0,1.8);setTimeout(()=>{try{oscA.stop();oscB.stop();}catch(e){}},1900);},
    };
  },

  epitrochoid: (dest) => {
    const masterG = new Tone.Gain(0.0);
    masterG.connect(dest);

    const baseFreq = 110;
    const osc1 = new Tone.Oscillator({ type:'sine', frequency: baseFreq });
    const g1   = new Tone.Gain(0.40);
    osc1.connect(g1); g1.connect(masterG);
    const breathC1 = new Tone.LFO({ frequency: 0.03, min: 0.32, max: 0.48 }).start();
    breathC1.connect(g1.gain);

    const osc2 = new Tone.Oscillator({ type:'triangle', frequency: baseFreq * 2.0 });
    const ringCarrier = new Tone.Oscillator({ type:'sine', frequency: baseFreq * 2.73 });
    const ringMod = new Tone.Multiply();
    osc2.connect(ringMod);
    ringCarrier.connect(ringMod.factor);
    const g2 = new Tone.Gain(0.0);
    ringMod.connect(g2); g2.connect(masterG);

    const rotLFO = new Tone.LFO({ frequency: 0.5, min: 0, max: 0.28 }).start();
    rotLFO.connect(g2.gain);
    const rotFreqLFO = new Tone.LFO({ frequency: 0.5, min: -18, max: 18 }).start();
    rotFreqLFO.connect(osc2.detune);

    const osc3 = new Tone.Oscillator({ type:'sine', frequency: baseFreq * 3.0 });
    const g3   = new Tone.Gain(0.0);
    osc3.connect(g3); g3.connect(masterG);

    return {nodes:[masterG,osc1,osc2,osc3,ringCarrier,ringMod,g1,g2,g3,breathC1,rotLFO,rotFreqLFO],_isGlue:true,
      setFreq:()=>{},
      setCurv:()=>{},
      setBreath:(bf)=>{masterG.gain.rampTo(bf * 0.22, 0.8);},
      setVel:()=>{},
      tickDist:()=>{},
      _setVelAng:(velAng)=>{
        const rotSpeed = 0.15 + velAng * 3.5;
        rotLFO.frequency.rampTo(rotSpeed, 0.4);
        rotFreqLFO.frequency.rampTo(rotSpeed, 0.4);
        ringCarrier.frequency.rampTo(baseFreq * (2.5 + velAng * 0.8), 0.6);
        g3.gain.rampTo(velAng > 0.5 ? (velAng - 0.5) * 0.20 : 0, 0.5);
      },
      start:()=>{osc1.start(); osc2.start(); osc3.start(); ringCarrier.start();},
      stop:()=>{masterG.gain.rampTo(0,2.0);setTimeout(()=>{try{osc1.stop();osc2.stop();osc3.stop();ringCarrier.stop();}catch(e){}},2200);},
    };
  },

  pursuit: (dest) => {
    const masterG = new Tone.Gain(0.0);
    masterG.connect(dest);
    const rev = _mkRev({ roomSize:0.28, dampening:0.9, wet:0.15 });
    masterG.connect(rev); rev.connect(dest);

    const oscA = new Tone.Oscillator({ type:'sine', frequency:148 });
    const oscB = new Tone.Oscillator({ type:'sine', frequency:222 });
    const oscRes = new Tone.Oscillator({ type:'sine', frequency:185 });
    const gA = new Tone.Gain(0.0);
    const gB = new Tone.Gain(0.0);
    const gRes = new Tone.Gain(0.0);
    oscA.connect(gA); gA.connect(masterG);
    oscB.connect(gB); gB.connect(masterG);
    oscRes.connect(gRes); gRes.connect(masterG);

    const driftA = new Tone.LFO({ frequency:0.07, min:-4, max:4 }).start();
    const driftB = new Tone.LFO({ frequency:0.11, min:-3, max:3 }).start();
    driftA.connect(oscA.detune);
    driftB.connect(oscB.detune);

    const shapeVoice = (tA, tB) => {
      const meetT = 0.5;
      const envA = tA <= meetT ? (tA / meetT) : Math.max(0, 1 - ((tA - meetT) / meetT));
      const envB = tB >= meetT ? ((1 - tB) / meetT) : Math.max(0, 1 - ((meetT - tB) / meetT));
      gA.gain.rampTo(Math.max(0, envA) * 0.16, 0.18);
      gB.gain.rampTo(Math.max(0, envB) * 0.16, 0.18);
    };

    let collided = false;

    return {nodes:[masterG,rev,oscA,oscB,oscRes,gA,gB,gRes,driftA,driftB],_isGlue:true,_isPursuit:true,
      setFreq:()=>{},
      setCurv:()=>{},
      setVel:()=>{},
      setBreath:(bf)=>{masterG.gain.rampTo(bf * 0.18, 1.0);},
      setFreqA:(f)=>{oscA.frequency.rampTo(f * 0.72, 0.22);},
      setFreqB:(f)=>{oscB.frequency.rampTo(f * 0.98, 0.22);},
      setBreathA:(bf)=>{gA.gain.rampTo(Math.max(gA.gain.value, bf * 0.06), 0.25);},
      setBreathB:(bf)=>{gB.gain.rampTo(Math.max(gB.gain.value, bf * 0.06), 0.25);},
      tickPursuit:(tA, tB)=>{ shapeVoice(tA, tB); },
      triggerMeet:(freq, vel)=>{
        if(collided) return;
        collided = true;
        const now = Tone.now();
        const scale = [98,110,130,147,165,185,196,220,247,262];
        oscRes.frequency.setValueAtTime(scale[Math.floor(Math.random() * scale.length)] || freq || 185, now);
        gRes.gain.cancelScheduledValues(now);
        gRes.gain.setValueAtTime(0, now);
        gRes.gain.rampTo(Math.max(0.18, Math.min(0.42, (vel || 0.7) * 0.45)), 0.06);
        gRes.gain.rampTo(0, 1.8);
        setTimeout(()=>{ collided = false; }, 2000);
      },
      start:()=>{oscA.start(); oscB.start(); oscRes.start(); shapeVoice(0, 1);},
      stop:()=>{
        masterG.gain.rampTo(0,2.0);
        setTimeout(()=>{try{oscA.stop(); oscB.stop(); oscRes.stop();}catch(e){}},2200);
      },
    };
  },
};

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  const PENTA_FREQS = [
    130.81,146.83,164.81,196.00,220.00,
    261.63,293.66,329.63,392.00,440.00,
    523.25,587.33,659.25,783.99,880.00,
  ];
  function xToFreq(x) {
    const t = Math.max(0, Math.min(1, x / (W || 1000)));
    const idx = Math.min(Math.floor(t * (PENTA_FREQS.length - 1)), PENTA_FREQS.length - 1);
    return PENTA_FREQS[idx];
  }
  function xToPan(x) { return (x / (W || 1000)) * 2 - 1; }

  const PERC_TYPES = new Set(['bezier','irregular','arc','angular']);

  // Perfiles de ensemble: el lab define la convivencia entre tipologías.
  const TYPE_PROFILES = {
    bezier: {
      voiceLimit: 1,
      level: 0.68,
      seqBuilder: () => _buildLegacySeqPts('bezier'),
      breath: () => ({periodMs:50000,silenceMs:20000,riseSec:1,fallSec:2,minLevel:0.0,shape:'pulse',rng:Math.random}),
    },
    sine: {
      voiceLimit: 4,
      level: 0.62,
      breath: () => ({periodMs:25000,silenceMs:4000,riseSec:6,fallSec:8,minLevel:0.04,shape:'smooth',rng:Math.random}),
    },
    arc: {
      voiceLimit: 2,
      level: 0.64,
      seqBuilder: () => _buildLegacySeqPts('arc'),
      breath: () => ({periodMs:35000,silenceMs:12000,riseSec:2,fallSec:4,minLevel:0.0,shape:'smooth',rng:Math.random}),
    },
    angular: {
      voiceLimit: 2,
      level: 0.6,
      seqBuilder: () => _buildLegacySeqPts('angular'),
      breath: () => ({periodMs:18000,silenceMs:10000,riseSec:3,fallSec:5,minLevel:0.0,shape:'smooth',rng:Math.random}),
    },
  spiral: {
      voiceLimit: 4,
      level: 0.7,
      breath: () => ({periodMs:15000,silenceMs:8000,riseSec:3,fallSec:5,minLevel:0.0,shape:'smooth',rng:Math.random}),
    },
  catenary: {
      voiceLimit: 4,
      level: 0.68,
      breath: () => ({periodMs:40000,silenceMs:6000,riseSec:8,fallSec:12,minLevel:0.08,shape:'smooth',rng:Math.random}),
    },
    clothoid: {
      voiceLimit: 2,
      level: 0.56,
      breath: () => ({periodMs:12000,silenceMs:7000,riseSec:4,fallSec:6,minLevel:0.0,shape:'smooth',rng:Math.random}),
    },
    irregular: {
      voiceLimit: 2,
      level: 0.6,
      seqBuilder: () => _buildLegacySeqPts('irregular'),
      breath: () => ({periodMs:8000,silenceMs:10000,riseSec:2,fallSec:4,minLevel:0.0,shape:'erratic',rng:Math.random}),
    },
    lissajous: {
      voiceLimit: 3,
      level: 0.54,
      breath: () => ({periodMs:20000,silenceMs:6000,riseSec:5,fallSec:7,minLevel:0.0,shape:'smooth',rng:Math.random}),
    },
  epitrochoid: {
      voiceLimit: 3,
      level: 0.64,
      breath: () => ({periodMs:10000,silenceMs:6000,riseSec:2,fallSec:4,minLevel:0.0,shape:'erratic',rng:Math.random}),
    },
    pursuit: {
      voiceLimit: 2,
      level: 0.52,
      breath: () => ({periodMs:30000,silenceMs:5000,riseSec:8,fallSec:12,minLevel:0.03,shape:'smooth',rng:Math.random}),
    },
  };

  function typeProfile(type) {
    return TYPE_PROFILES[type] || {
      voiceLimit: 3,
      level: 0.58,
      breath: () => ({periodMs:20000,silenceMs:8000,riseSec:4,fallSec:6,minLevel:0.0,shape:'smooth',rng:Math.random}),
    };
  }

  function breathConfig(type) {
    return typeProfile(type).breath();
  }

  function typeVoiceLevel(type, selectedCount) {
    const profile = typeProfile(type);
    const base = profile.level ?? 0.58;
    const count = Math.max(1, selectedCount || 1);
    const polyComp = 1 / Math.pow(count, 0.18);
    return Math.max(0.26, Math.min(1.0, base * polyComp));
  }

  const TYPE_COMPLEXITY_COST = {
    bezier: 2.1,
    sine: 1.0,
    arc: 3.1,
    angular: 2.9,
    spiral: 1.2,
    catenary: 1.0,
    clothoid: 3.4,
    irregular: 2.5,
    lissajous: 1.5,
    epitrochoid: 1.7,
    pursuit: 2.2,
  };
  const TOTAL_COMPLEXITY_BUDGET = 11.5;

  function typeComplexityCost(type) {
    return TYPE_COMPLEXITY_COST[type] ?? 1.8;
  }

  const SIKU_COLOR_UP   = '#90d8ff';
  const SIKU_COLOR_DOWN = '#ffb870';
  const SIKU_FREQS = [196.00, 220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00];
  const SIKU_RAMP  = 0.22;
  const SIKU_H_MAX = 36;
  const SIKU_H_MIN = 3;

  function buildSikuVoice(dest, freq, up) {
    if(!dest) return null;
    const now = Tone.now();
    const f = Math.min(freq, 440);
    const fLow = f * 0.5;
    const masterG = new Tone.Gain(0.0);
    masterG.connect(dest);

    const res = _mkRev({ roomSize: 0.15, dampening: 0.88, wet: 0.18 });
    masterG.connect(res); res.connect(dest);

    const wsCurve = new Float32Array(256);
    for(let i=0;i<256;i++){
      const x = (i * 2 / 255) - 1;
      wsCurve[i] = x > 0 ? Math.tanh(x * 2.8) * 0.75 : Math.tanh(x * 1.8) * 0.85;
    }
    const ws = new Tone.WaveShaper(wsCurve);
    ws.connect(masterG);

    const drift1 = new Tone.LFO({ frequency:0.13, min:-18, max:18 }).start();
    const drift2 = new Tone.LFO({ frequency:0.31, min:-8,  max:8  }).start();
    const drift3 = new Tone.LFO({ frequency:0.07, min:-30, max:30 }).start();

    const toneLP = new Tone.Filter({ type:'lowpass', frequency: f * 2.8, Q:1.2 });
    toneLP.connect(ws);
    const osc1 = new Tone.Oscillator({ type:'sawtooth', frequency: f * 0.997 });
    const osc2 = new Tone.Oscillator({ type:'sawtooth', frequency: f * 1.005 });
    const g1 = new Tone.Gain(0.22); osc1.chain(g1, toneLP);
    const g2 = new Tone.Gain(0.16); osc2.chain(g2, toneLP);
    drift1.connect(osc1.detune);
    drift2.connect(osc2.detune);

    const toneLPlo = new Tone.Filter({ type:'lowpass', frequency: fLow * 2.8, Q:1.2 });
    toneLPlo.connect(ws);
    const oscLo = new Tone.Oscillator({ type:'sawtooth', frequency: fLow * 0.998 });
    const gLo = new Tone.Gain(0.28); oscLo.chain(gLo, toneLPlo);
    drift3.connect(oscLo.detune);

    const fMulti = f * 2.73;
    const oscMulti = new Tone.Oscillator({ type:'sine', frequency: fMulti });
    const gMulti = new Tone.Gain(0.0);
    const multiLP = new Tone.Filter({ type:'lowpass', frequency: fMulti * 1.5, Q:2 });
    oscMulti.chain(gMulti, multiLP, ws);
    const multiLFO = new Tone.LFO({ frequency: 0.08 + Math.random() * 0.12, min:0.0, max:0.10 }).start();
    multiLFO.connect(gMulti.gain);

    const blowA  = new Tone.Noise('pink');
    const filtA  = new Tone.Filter({ type:'bandpass', frequency: f * 1.05, Q:3 });
    const gBlowA = new Tone.Gain(0.55);
    blowA.chain(filtA, gBlowA, ws);

    const blowB  = new Tone.Noise('white');
    const filtB  = new Tone.Filter({ type:'bandpass', frequency: f * 3.2, Q:5 });
    const gBlowB = new Tone.Gain(0.22);
    blowB.chain(filtB, gBlowB, ws);

    const dirtLFO = new Tone.LFO({ frequency:0.11 + Math.random() * 0.18, min:f * 0.7, max:f * 1.6 }).start();
    dirtLFO.connect(filtA.frequency);

    const fSub = f * 0.25;
    const subLP = new Tone.Filter({ type:'lowpass', frequency: fSub * 2.2, Q: 0.6 });
    subLP.connect(masterG);
    const oscSub1 = new Tone.Oscillator({ type:'sine', frequency: fSub * 0.999 });
    const oscSub2 = new Tone.Oscillator({ type:'sine', frequency: fSub * 1.002 });
    const gSub1 = new Tone.Gain(0.45); oscSub1.chain(gSub1, subLP);
    const gSub2 = new Tone.Gain(0.35); oscSub2.chain(gSub2, subLP);
    const subBreath = new Tone.LFO({ frequency:0.05 + Math.random() * 0.04, min:0.30, max:0.55 }).start();
    subBreath.connect(gSub1.gain);
    const subDrift = new Tone.LFO({ frequency:0.09, min:-5, max:5 }).start();
    subDrift.connect(oscSub1.detune);

    oscSub1.start(now); oscSub2.start(now);
    osc1.start(now); osc2.start(now); oscLo.start(now); oscMulti.start(now);
    blowA.start(now); blowB.start(now);

    const nodes = [osc1,osc2,oscLo,oscMulti,blowA,blowB,oscSub1,oscSub2,
      filtA,filtB,toneLP,toneLPlo,multiLP,subLP,g1,g2,gLo,gMulti,gBlowA,gBlowB,gSub1,gSub2,
      drift1,drift2,drift3,multiLFO,dirtLFO,subBreath,subDrift,ws,res,masterG];

    return { masterG, nodes, oscSub1, oscSub2 };
  }

  function disposeSikuVoice(voice){
    if(!voice) return;
    voice.nodes.forEach(n => { try{ n.dispose(); }catch(e){} });
  }

  function initSikuPtsForVoice(v){
    const t1 = 0.15 + Math.random() * 0.28;
    const t2 = 0.57 + Math.random() * 0.28;
    let f1 = SIKU_FREQS[Math.floor(Math.random() * SIKU_FREQS.length)];
    let f2 = SIKU_FREQS[Math.floor(Math.random() * SIKU_FREQS.length)];
    while(f2 === f1) f2 = SIKU_FREQS[Math.floor(Math.random() * SIKU_FREQS.length)];
    v.sikuPts = [
      { t:t1, freq:f1, up:Math.random()<0.5, h:SIKU_H_MIN + Math.random() * (SIKU_H_MAX - SIKU_H_MIN), voice:null },
      { t:t2, freq:f2, up:Math.random()<0.5, h:SIKU_H_MIN + Math.random() * (SIKU_H_MAX - SIKU_H_MIN), voice:null },
    ];
  }

  function stopSikuForVoice(v){
    (v.sikuPts || []).forEach(sp => {
      if(sp.voice){
        try{ sp.voice.masterG.gain.cancelScheduledValues(Tone.now()); }catch(e){}
        try{ sp.voice.masterG.gain.setValueAtTime(0, Tone.now()); }catch(e){}
        const toDispose = sp.voice;
        sp.voice = null;
        setTimeout(() => disposeSikuVoice(toDispose), 200);
      }
    });
  }

  function tickSikuForVoice(v, tNow){
    (v.sikuPts || []).forEach(sp => {
      const tA = sp.t - SIKU_RAMP;
      const tB = sp.t + SIKU_RAMP;
      const inZone = tNow >= tA && tNow <= tB;
      if(inZone){
        if(!sp.voice) sp.voice = buildSikuVoice(v.pan, sp.freq, sp.up);
        if(!sp.voice) return;
        const tNorm = tNow <= sp.t
          ? Math.pow((tNow - tA) / SIKU_RAMP, 3)
          : Math.pow(1 - (tNow - sp.t) / SIKU_RAMP, 2);
        const volMax = 0.039 * (sp.h / SIKU_H_MAX);
        sp.voice.masterG.gain.rampTo(Math.max(0, Math.min(1, tNorm)) * volMax, 0.08);
        if(tNow > sp.t && sp.voice.oscSub1){
          const fallT = 1.0 - Math.sqrt(Math.max(0, tNorm));
          const detune = fallT * 38;
          try{
            sp.voice.oscSub1.detune.rampTo(detune, 0.1);
            sp.voice.oscSub2.detune.rampTo(-detune * 0.6, 0.1);
          }catch(e){}
        } else if(sp.voice.oscSub1){
          try{
            sp.voice.oscSub1.detune.rampTo(0, 0.3);
            sp.voice.oscSub2.detune.rampTo(0, 0.3);
          }catch(e){}
        }
      } else if(sp.voice){
        sp.voice.masterG.gain.rampTo(0, 0.25);
        const toDispose = sp.voice;
        sp.voice = null;
        setTimeout(() => disposeSikuVoice(toDispose), 400);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ESTADO
  // ══════════════════════════════════════════════════════════════════════════

  let _initialized = false;
  let _running     = false;
  let _masterVol   = null;
  let _percBus     = null;
  let _glueBus     = null;
  let _sources     = [];
  let _rafId       = null;
  let _showViz     = false;
  let _showSeqViz  = false;
  let _baseSpeed   = 0.38;
  let _lastVizMs   = 0;
  const _vizFrameMs = 1000 / 24;
  const _typeTrimDb = new Map();
  const _perfStats = {
    buildMs: 0,
    buildCount: 0,
    tickMs: 0,
    tickCount: 0,
    drawMs: 0,
    drawCount: 0,
    rebuildMs: 0,
    rebuildCount: 0,
    lastBuildMs: 0,
    lastTickMs: 0,
    lastDrawMs: 0,
    lastRebuildMs: 0,
  };

  function _perfAvg(total, count) {
    return count ? total / count : 0;
  }

  function _capturePerfSnapshot() {
    const voiceCount = _sources.reduce((sum, src) => sum + (src.voices ? src.voices.length : 0), 0);
    return {
      voices: voiceCount,
      sourceGroups: _sources.length,
      avgBuildMs: _perfAvg(_perfStats.buildMs, _perfStats.buildCount),
      avgTickMs: _perfAvg(_perfStats.tickMs, _perfStats.tickCount),
      avgDrawMs: _perfAvg(_perfStats.drawMs, _perfStats.drawCount),
      avgRebuildMs: _perfAvg(_perfStats.rebuildMs, _perfStats.rebuildCount),
      lastBuildMs: _perfStats.lastBuildMs,
      lastTickMs: _perfStats.lastTickMs,
      lastDrawMs: _perfStats.lastDrawMs,
      lastRebuildMs: _perfStats.lastRebuildMs,
      vizFpsTarget: Math.round(1000 / _vizFrameMs),
    };
  }

  function _dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  function _trimDbFor(type) {
    return _typeTrimDb.has(type) ? _typeTrimDb.get(type) : 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════════

  async function _init() {
    if (_initialized) return;
    await Tone.start();
    Tone.getContext().lookAhead = 0.01;
    const _limiter = new Tone.Limiter(-1).toDestination();
    _masterVol = new Tone.Volume(-6);
    _masterVol.connect(_limiter);
    _percBus   = new Tone.Volume(-2);
    _glueBus   = new Tone.Volume(3);
    _percBus.connect(_masterVol);
    _glueBus.connect(_masterVol);
    _initialized = true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEQ PTS
  // ══════════════════════════════════════════════════════════════════════════

  function _pickIdx(pool, count, minDist) {
    const av=[...pool], ch=[]; let att=0;
    while(ch.length<count && att<300){
      att++;
      if(!av.length) break;
      const ri=Math.floor(Math.random()*av.length);
      const val=av[ri];
      if(ch.every(c=>Math.abs(c-val)>=minDist)){ ch.push(val); av.splice(ri,1); }
    }
    return ch;
  }

  function _buildLegacySeqPts(type) {
    const N = type==='bezier'?4 : type==='arc'?6 : type==='irregular'?4 : 3;
    const pts = [];
    for(let i=0;i<N;i++){
      const base=(i+0.5)/N;
      const jitter=(Math.random()-0.5)*(1/N)*0.3;
      pts.push({t:Math.max(0.02,Math.min(0.98,base+jitter)),triggered:false,special:false,ultra:false});
    }
    pts.sort((a,b)=>a.t-b.t);
    if((type==='arc'||type==='irregular') && pts.length>=2){
      const allIdx=pts.map((_,i)=>i);
      const sc=pts.length<=4?1:(Math.random()<0.5?2:3);
      const si=_pickIdx(allIdx,sc,2);
      si.forEach(i=>{pts[i].special=true;});
      if(type==='arc' && pts.length>=4){
        const uc=Math.random()<0.5?1:2;
        const up=allIdx.filter(i=>!pts[i].special && si.every(s=>Math.abs(s-i)>=2));
        _pickIdx(up,uc,3).forEach(i=>{pts[i].ultra=true;});
      }
    }
    return pts;
  }

  function _buildSeqPts(type) {
    const profile = typeProfile(type);
    return profile.seqBuilder ? profile.seqBuilder() : _buildLegacySeqPts(type);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SILENCE SOURCES — desconecta rápido, dispose diferido
  // ══════════════════════════════════════════════════════════════════════════

  function _silenceSources(oldSources) {
    oldSources.forEach(src => {
      src.voices.forEach(v => {
        try { v.voice.stop(); } catch(e){}
        try { v.breath && v.breath.stop(); } catch(e){}
        try { stopSikuForVoice(v); } catch(e){}
        try { v.pan.disconnect(); } catch(e){}
        try { v.level && v.level.disconnect(); } catch(e){}
        setTimeout(() => {
          try { (v.voice.nodes||[]).forEach(n=>{ try{n.dispose();}catch(e){} }); } catch(e){}
          try { v.pan.dispose(); } catch(e){}
          try { v.level && v.level.dispose(); } catch(e){}
        }, 2500);
      });
      try { src.typeGain && src.typeGain.disconnect(); } catch(e){}
      setTimeout(() => {
        try { src.typeGain && src.typeGain.dispose(); } catch(e){}
      }, 2500);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD SOURCES — itera acousticNodes, cada nodo activa su tipología
  // ══════════════════════════════════════════════════════════════════════════

  function _cxMean(crvList) {
    let sum=0;
    crvList.forEach(crv=>{
      const pts=crv.pts||[];
      if(pts.length) sum+=pts[Math.floor(pts.length/2)].x;
    });
    return crvList.length ? sum/crvList.length : (W||1000)*0.5;
  }

  function _spreadSelect(crvList, limit) {
    const sorted = crvList.map(crv=>{
      const pts=crv.pts||[];
      const cx=pts.length?pts[Math.floor(pts.length/2)].x:0;
      return {crv,cx};
    }).sort((a,b)=>a.cx-b.cx);
    const step=(sorted.length-1)/Math.max(1,limit-1);
    return Array.from({length:limit},(_,i)=>sorted[Math.round(i*step)].crv);
  }

  function _prepareCurveData(pts, seqPts) {
    const count = pts.length;
    let totalPx = 0;
    const curvatures = new Array(count).fill(0);
    for(let i=1;i<count;i++) totalPx += Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
    totalPx = Math.max(totalPx, 300);
    for(let i=0;i<count;i++){
      const iA=Math.max(0,i-1), iC=Math.min(count-1,i+1);
      const dxA=pts[i].x-pts[iA].x, dyA=pts[i].y-pts[iA].y;
      const dxC=pts[iC].x-pts[i].x, dyC=pts[iC].y-pts[i].y;
      const lA=Math.hypot(dxA,dyA)||1, lC=Math.hypot(dxC,dyC)||1;
      curvatures[i]=Math.max(0,Math.min(1,(1-(dxA*dxC+dyA*dyC)/(lA*lC))/2));
    }
    const seqData = (seqPts || []).map(sp => {
      const idx = Math.floor(sp.t * (count - 1));
      const p = pts[idx];
      return { idx, freq: p ? xToFreq(p.x) : null };
    });
    return { totalPx, curvatures, seqData };
  }

  function _needsParamUpdate(lastValue, nextValue, epsilon) {
    return lastValue == null || Math.abs(lastValue - nextValue) >= epsilon;
  }

  function _buildSources() {
    const perfStart = performance.now();
    if(!curves?.length) return;
    if(!(acousticNodes||[]).length) return;
    let remainingBudget = TOTAL_COMPLEXITY_BUDGET;
    const activeNodeCount = (acousticNodes || []).filter(node => node && node._audioType && SYNTH_DEFS[node._audioType]).length;
    const reservePerNode = activeNodeCount > 0 ? TOTAL_COMPLEXITY_BUDGET / activeNodeCount : TOTAL_COMPLEXITY_BUDGET;

    (acousticNodes||[]).forEach(node => {
      const type = node._audioType;
      if(!type || !SYNTH_DEFS[type]) return;

      const crvList = curves.filter(c=>c.type===type);
      if(!crvList.length) return;

      const profile  = typeProfile(type);
      const panCtr   = xToPan(node.cx);
      const isPerc   = PERC_TYPES.has(type);
      const dest     = isPerc ? _percBus : _glueBus;
      const limit    = profile.voiceLimit ?? 3;
      const costPerVoice = typeComplexityCost(type);
      const guaranteedBudget = Math.min(remainingBudget, Math.max(costPerVoice, reservePerNode));
      const allowedByBudget = Math.max(0, Math.floor(guaranteedBudget / costPerVoice));
      const effectiveLimit = Math.min(limit, Math.max(0, allowedByBudget));
      if(effectiveLimit < 1) return;
      const selected = crvList.length<=effectiveLimit ? crvList : _spreadSelect(crvList,effectiveLimit);
      remainingBudget -= selected.length * costPerVoice;
      node._audioVoiceCount = selected.length;
      const perVoiceLevel = typeVoiceLevel(type, selected.length);
      const typeGain = new Tone.Gain(_dbToGain(_trimDbFor(type)));
      typeGain.connect(dest);

      const voices = selected.map((crv, vi) => {
        const pts = crv.pts || [];

        const spread = selected.length>1 ? ((vi/(selected.length-1))-0.5)*0.4 : 0;
        const pan    = new Tone.Panner(Math.max(-1,Math.min(1,panCtr+spread)));
        const level  = new Tone.Gain(perVoiceLevel);
        pan.connect(level);
        level.connect(typeGain);

        const voice = SYNTH_DEFS[type](pan);

        const speedMul = (node && node._speedMuls && node._speedMuls[vi] != null)
          ? Math.max(0.4, Math.min(2.0, node._speedMuls[vi]))
          : 0.5 + Math.random()*1.0;
        const forward  = (node && node._forwards && node._forwards[vi] != null)
          ? node._forwards[vi]
          : Math.random()<0.5;

        let breath=null;
        if(!isPerc){
          breath=new BreathCycle(breathConfig(type));
          breath.start(true);
        }

        const seqPts = isPerc ? _buildSeqPts(type) : null;
        const curveData = _prepareCurveData(pts, seqPts);
        let sikuPts = null;
        if(type === 'clothoid'){
          const sikuState = { sikuPts: [] };
          initSikuPtsForVoice(sikuState);
          sikuPts = sikuState.sikuPts;
        }
        voice.start();
        if(isPerc && seqPts && seqPts.length){
          const seedIdx = Math.floor(Math.random() * seqPts.length);
          const sp = seqPts[seedIdx];
          const pi = Math.floor(sp.t * (pts.length - 1));
          const seedFreq = pts[pi] ? xToFreq(pts[pi].x) : xToFreq(node.cx);
          setTimeout(() => {
            try{ if(voice.setFreq) voice.setFreq(seedFreq); }catch(e){}
            try{
              const seedVel = 0.32 + Math.random() * 0.18;
              if(sp.ultra && voice.triggerScale)        voice.triggerScale(seedFreq, seedVel);
              else if(sp.special && voice.triggerChord) voice.triggerChord(seedFreq, seedVel);
              else if(voice.triggerAt)                  voice.triggerAt(seedVel);
            }catch(e){}
          }, 120 + Math.random() * 380);
        }

        const startT = type === 'pursuit'
          ? (forward ? 0 : 1)
          : (0.08 + Math.random() * 0.84);

        return {
          pts, totalPx: curveData.totalPx, curveData,
          t: startT, forward, speedMul,
          voice, breath, pan, level, seqPts, sikuPts,
          _px:undefined, _py:undefined,
          _triggered: new Set(),
          _lastFreq:null, _lastBreath:null, _lastCurv:null, _lastVel:null,
          _lastPos:null, _lastRad:null, _lastVelAng:null,
          t2: forward?1:0, t2spd:0.5+Math.random()*1.0,
          _px2:undefined, _py2:undefined,
          _metThisCycle:false, _meetFlash:null,
        };
      });

      _sources.push({type, voices, typeGain});
    });
    const elapsed = performance.now() - perfStart;
    _perfStats.buildMs += elapsed;
    _perfStats.buildCount += 1;
    _perfStats.lastBuildMs = elapsed;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TICK
  // ══════════════════════════════════════════════════════════════════════════

  function _tick() {
    const perfStart = performance.now();
    _sources.forEach(src => {
      const isPerc = PERC_TYPES.has(src.type);
      src.voices.forEach(v => {
        const pts = v.pts;
        if(!pts||pts.length<2) return;

        const prevT   = v.t;
        const prevFwd = v.forward;
        const dtNorm  = (_baseSpeed * v.speedMul) / v.totalPx;
        v.t += v.forward ? dtNorm : -dtNorm;
        if(v.t>=1){v.t=1;v.forward=false;}
        if(v.t<=0){v.t=0;v.forward=true;}
        if(v.forward!==prevFwd){
          v._triggered.clear();
          if(v.seqPts) v.seqPts.forEach(sp => { sp.triggered = false; });
        }

        const rawIdx=v.t*(pts.length-1);
        const idx0=Math.floor(rawIdx);
        const idx1=Math.min(idx0+1,pts.length-1);
        const frac=rawIdx-idx0;
        const px=pts[idx0].x+(pts[idx1].x-pts[idx0].x)*frac;
        const py=pts[idx0].y+(pts[idx1].y-pts[idx0].y)*frac;
        const dist=v._px!=null?Math.hypot(px-v._px,py-v._py):0;
        const curvK=v.curveData?.curvatures?.[idx0] ?? 0;

        if(isPerc){
          if(v.seqPts){
            v.seqPts.forEach((sp,si)=>{
              const crossed=v.forward?(prevT<=sp.t&&v.t>=sp.t):(prevT>=sp.t&&v.t<=sp.t);
              if(crossed&&!v._triggered.has(si)){
                v._triggered.add(si);
                sp.triggered = true;
                const freq=v.curveData?.seqData?.[si]?.freq ?? xToFreq(px);
                try{ if(v.voice.setFreq) v.voice.setFreq(freq); }catch(e){}
                const vel=Math.max(0.35,Math.min(1.0,0.4+curvK*0.6));
                try{
                  if(sp.ultra&&v.voice.triggerScale)        v.voice.triggerScale(freq,vel);
                  else if(sp.special&&v.voice.triggerChord) v.voice.triggerChord(freq,vel);
                  else if(v.voice.triggerAt)                v.voice.triggerAt(vel);
                }catch(e){}
              }
            });
          }
        } else {
          const bf=v.breath?v.breath.factor:1;
          const expDist=_baseSpeed*v.speedMul*0.016;
          const localSpd=Math.max(0,Math.min(1,dist/(expDist||0.001)));
          const xNorm = Math.max(0, Math.min(1, px / (W || 1000)));
          const radNorm = 1 - Math.abs(v.t - 0.5) * 2;
          const freqNow = xToFreq(px);
          const breathNow = bf;
          const curvNow = curvK * bf;
          const velNow = localSpd * bf;
          if(_needsParamUpdate(v._lastFreq, freqNow, 0.5)){
            try{ if(v.voice.setFreq) v.voice.setFreq(freqNow); }catch(e){}
            v._lastFreq = freqNow;
          }
          if(_needsParamUpdate(v._lastBreath, breathNow, 0.025)){
            try{ if(v.voice.setBreath) v.voice.setBreath(breathNow); }catch(e){}
            v._lastBreath = breathNow;
          }
          if(_needsParamUpdate(v._lastCurv, curvNow, 0.025)){
            try{ if(v.voice.setCurv) v.voice.setCurv(curvNow); }catch(e){}
            v._lastCurv = curvNow;
          }
          if(_needsParamUpdate(v._lastVel, velNow, 0.03)){
            try{ if(v.voice.setVel) v.voice.setVel(velNow); }catch(e){}
            v._lastVel = velNow;
          }
          if(_needsParamUpdate(v._lastPos, xNorm, 0.015)){
            try{ if(v.voice._setPos) v.voice._setPos(xNorm); }catch(e){}
            v._lastPos = xNorm;
          }
          if(_needsParamUpdate(v._lastRad, radNorm, 0.02)){
            try{ if(v.voice._setRad) v.voice._setRad(radNorm); }catch(e){}
            v._lastRad = radNorm;
          }
          if(_needsParamUpdate(v._lastVelAng, localSpd, 0.03)){
            try{ if(v.voice._setVelAng) v.voice._setVelAng(localSpd); }catch(e){}
            v._lastVelAng = localSpd;
          }
          try{ if(v.voice.tickDist)   v.voice.tickDist(dist*bf); }catch(e){}
          // Pursuit: segundo viajero
          if(v.voice._isPursuit){
            try{
              const prevT2=v.t2;
              const dt2=(_baseSpeed*v.t2spd)/v.totalPx;
              v.t2+=v.forward?-dt2:dt2;
              if(v.t2>=1)v.t2=1; if(v.t2<=0)v.t2=0;
              const r2=v.t2*(pts.length-1);
              const i2a=Math.floor(r2),i2b=Math.min(i2a+1,pts.length-1),f2=r2-i2a;
              const px2=pts[i2a].x+(pts[i2b].x-pts[i2a].x)*f2;
              const py2=pts[i2a].y+(pts[i2b].y-pts[i2a].y)*f2;
              try{ if(v.voice.setFreqA) v.voice.setFreqA(xToFreq(px));  }catch(e){}
              try{ if(v.voice.setFreqB) v.voice.setFreqB(xToFreq(px2)); }catch(e){}
              try{ if(v.voice.setBreathA) v.voice.setBreathA(bf); }catch(e){}
              try{ if(v.voice.setBreathB) v.voice.setBreathB(bf); }catch(e){}
              try{ if(v.voice.tickPursuit) v.voice.tickPursuit(v.t, v.t2); }catch(e){}
              const crossed=(prevT<=prevT2&&v.t>=v.t2)||(prevT>=prevT2&&v.t<=v.t2);
              if(crossed&&!v._metThisCycle){
                v._metThisCycle=true;
                const meetFreq=xToFreq((px+px2)*0.5);
                const meetVel=Math.max(0.5,Math.min(1.0,0.5+curvK*0.5));
                try{ v.voice.triggerMeet(meetFreq,meetVel); }catch(e){}
                v._meetFlash={px:(px+px2)*0.5,py:(py+py2)*0.5,alpha:1.0};
                setTimeout(()=>{v._metThisCycle=false;},2000);
              }
              v._px2=px2; v._py2=py2;
            }catch(e){}
          }
          if(src.type === 'clothoid' && v.sikuPts){
            try{ tickSikuForVoice(v, v.t); }catch(e){}
          }
        }
        v._px=px; v._py=py;
      });
    });
    const elapsed = performance.now() - perfStart;
    _perfStats.tickMs += elapsed;
    _perfStats.tickCount += 1;
    _perfStats.lastTickMs = elapsed;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MASTER LOOP
  // ══════════════════════════════════════════════════════════════════════════

  function _masterLoop(){
    _rafId=requestAnimationFrame(_masterLoop);
    if(!_running) return;
    _tick();
    if(_showViz){
      const now = performance.now();
      if((now - _lastVizMs) >= _vizFrameMs){
        _lastVizMs = now;
        _drawViz();
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIZ — getBoundingClientRect para offset correcto
  // ══════════════════════════════════════════════════════════════════════════

  const TYPE_COLORS={
    bezier:'#4f7fff', sine:'#7fc8ff', arc:'#a0e8d0', angular:'#ffb86c',
    spiral:'#d8a0ff', catenary:'#ff9090', clothoid:'#90d8ff', irregular:'#c8c890',
    lissajous:'#ff6b35', epitrochoid:'#ff9960', pursuit:'#ffcc88',
  };

  function _getT() {
    if(!canvas||!overlay) return null;
    const wrap=canvas.parentElement; if(!wrap) return null;
    const wRect=wrap.getBoundingClientRect();
    const cRect=canvas.getBoundingClientRect();
    return {
      ox:cRect.left-wRect.left, oy:cRect.top-wRect.top,
      visW:cRect.width, visH:cRect.height,
      sx:cRect.width/(W||1), sy:cRect.height/(H||1),
    };
  }

  function _drawViz(){
    const perfStart = performance.now();
    const T=_getT(); if(!T) return;
    const ov=overlay.getContext('2d'); if(!ov) return;
    ov.clearRect(0, 0, overlay.width, overlay.height);
    ov.save();
    ov.beginPath();
    ov.rect(T.ox, T.oy, T.visW, T.visH);
    ov.clip();

    _sources.forEach(src=>{
      const color=TYPE_COLORS[src.type]||'#fff';
      const isPerc=PERC_TYPES.has(src.type);
      src.voices.forEach(v=>{
        const pts=v.pts;
        if(!pts||pts.length<2) return;
        const ri=v.t*(pts.length-1);
        const i0=Math.floor(ri),i1=Math.min(i0+1,pts.length-1),fr=ri-i0;
        const px=pts[i0].x+(pts[i1].x-pts[i0].x)*fr;
        const py=pts[i0].y+(pts[i1].y-pts[i0].y)*fr;
        const ex=T.ox+px*T.sx, ey=T.oy+py*T.sy;
        const bf=v.breath?v.breath.factor:1;
        const r=Math.max(3,(4+bf*5)*Math.min(T.sx,T.sy));

        if(isPerc){
          ov.beginPath(); ov.arc(ex,ey,r,0,Math.PI*2);
          ov.fillStyle=color+'88'; ov.fill();
          ov.strokeStyle=color+'cc'; ov.lineWidth=1; ov.stroke();
        } else {
          const tx=pts[i1].x-pts[i0].x, ty=pts[i1].y-pts[i0].y;
          const ang=Math.atan2(ty,tx)+(v.forward?0:Math.PI);
          ov.save(); ov.translate(ex,ey); ov.rotate(ang);
          ov.beginPath();
          ov.moveTo(r,0); ov.lineTo(-r,-r*0.65); ov.lineTo(-r*0.5,0); ov.lineTo(-r,r*0.65);
          ov.closePath();
          ov.fillStyle=color+'bb'; ov.strokeStyle=color; ov.lineWidth=0.8;
          ov.fill(); ov.stroke(); ov.restore();

          // Pursuit: viajero B
          if(v.voice._isPursuit && v._px2!=null){
            const ex2=T.ox+v._px2*T.sx, ey2=T.oy+v._py2*T.sy;
            const r2i=v.t2*(pts.length-1);
            const i2a=Math.floor(r2i),i2b=Math.min(i2a+1,pts.length-1);
            const tx2=pts[i2b].x-pts[i2a].x, ty2=pts[i2b].y-pts[i2a].y;
            const ang2=Math.atan2(ty2,tx2)+(v.forward?Math.PI:0);
            ov.save(); ov.translate(ex2,ey2); ov.rotate(ang2);
            ov.beginPath();
            ov.moveTo(r,0); ov.lineTo(-r,-r*0.65); ov.lineTo(-r*0.5,0); ov.lineTo(-r,r*0.65);
            ov.closePath();
            ov.fillStyle=color+'77'; ov.strokeStyle=color+'aa'; ov.lineWidth=0.8;
            ov.fill(); ov.stroke(); ov.restore();
          }
          // Meet flash
          if(v._meetFlash&&v._meetFlash.alpha>0){
            const mf=v._meetFlash;
            mf.alpha=Math.max(0,mf.alpha-0.025);
            const mx=T.ox+mf.px*T.sx, my=T.oy+mf.py*T.sy;
            const fr2=mf.alpha*18*Math.min(T.sx,T.sy);
            ov.beginPath(); ov.arc(mx,my,fr2,0,Math.PI*2);
            ov.strokeStyle=color+Math.floor(mf.alpha*180).toString(16).padStart(2,'0');
            ov.lineWidth=1.5; ov.stroke();
          }
        }

        // Seq pts markers
        if(_showSeqViz&&v.seqPts){
          v.seqPts.forEach(sp=>{
            const pi=Math.floor(sp.t*(pts.length-1));
            const p=pts[pi]; if(!p) return;
            const mx=T.ox+p.x*T.sx, my=T.oy+p.y*T.sy;
            if(sp.ultra){
              ov.beginPath(); ov.arc(mx,my,3.5,0,Math.PI*2);
              ov.fillStyle='#f0e060cc'; ov.fill();
            } else if(sp.special){
              ov.save(); ov.translate(mx,my); ov.rotate(Math.PI/4);
              ov.fillStyle=color+'cc'; ov.fillRect(-2.5,-2.5,5,5); ov.restore();
            } else {
              ov.beginPath(); ov.arc(mx,my,2,0,Math.PI*2);
              ov.fillStyle=color+'77'; ov.fill();
            }
          });
        }

        if(src.type === 'clothoid' && _showSeqViz && v.sikuPts && pts.length > 4){
          v.sikuPts.forEach(sp => {
            const tA = Math.max(0.001, sp.t - SIKU_RAMP);
            const tB = Math.min(0.999, sp.t + SIKU_RAMP);
            const posA = pts[Math.floor(tA * (pts.length - 1))];
            const posB = pts[Math.floor(tB * (pts.length - 1))];
            const posP = pts[Math.floor(sp.t * (pts.length - 1))];
            if(!posA || !posB || !posP) return;
            const rampH = sp.h;
            const norm = Math.hypot(posP.x - posA.x, posP.y - posA.y) || 1;
            const nx = -(posP.y - posA.y) / norm;
            const ny = (posP.x - posA.x) / norm;
            const dir = sp.up ? 1 : -1;
            const peak = { x: posP.x + nx * rampH * dir, y: posP.y + ny * rampH * dir };
            const col = sp.up ? SIKU_COLOR_UP : SIKU_COLOR_DOWN;
            const alpha = sp.voice ? 'cc' : '44';
            ov.setLineDash([3,4]);
            ov.beginPath();
            ov.moveTo(T.ox + posA.x * T.sx, T.oy + posA.y * T.sy);
            ov.lineTo(T.ox + peak.x * T.sx, T.oy + peak.y * T.sy);
            ov.strokeStyle = col + alpha;
            ov.lineWidth = sp.voice ? 1.0 : 0.5;
            ov.stroke();
            ov.beginPath();
            ov.moveTo(T.ox + peak.x * T.sx, T.oy + peak.y * T.sy);
            ov.lineTo(T.ox + posB.x * T.sx, T.oy + posB.y * T.sy);
            ov.strokeStyle = col + alpha;
            ov.lineWidth = sp.voice ? 1.0 : 0.5;
            ov.stroke();
            ov.setLineDash([]);
          });
        }
      });
    });
    ov.restore();
    const elapsed = performance.now() - perfStart;
    _perfStats.drawMs += elapsed;
    _perfStats.drawCount += 1;
    _perfStats.lastDrawMs = elapsed;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ══════════════════════════════════════════════════════════════════════════

  async function start(){
    await _init();
    await Tone.start();
    _sources=[];
    _buildSources();
    _running=true;
    _lastVizMs=0;
    if(!_rafId) _masterLoop();
  }

  function stop(){
    _running=false;
    const old=_sources; _sources=[];
    _silenceSources(old);
    if(overlay){const o=overlay.getContext('2d');if(o)o.clearRect(0,0,overlay.width,overlay.height);}
  }

  let _onRebuild=null;
  function onRebuild(fn){ _onRebuild=fn; }

  function rebuild(){
    const perfStart = performance.now();
    if(!_running) return;
    const wasViz=_showViz;
    stop();
    setTimeout(async()=>{
      await start();
      if(wasViz) startViz();
      if(typeof _onRebuild==='function') _onRebuild();
      const elapsed = performance.now() - perfStart;
      _perfStats.rebuildMs += elapsed;
      _perfStats.rebuildCount += 1;
      _perfStats.lastRebuildMs = elapsed;
    }, 200);
  }

  function setVolume(db)     { if(_masterVol) _masterVol.volume.rampTo(db,0.5); }
  function setPercVolume(db) { if(_percBus)   _percBus.volume.rampTo(db,0.5); }
  function setGlueVolume(db) { if(_glueBus)   _glueBus.volume.rampTo(db,0.5); }
  function setSpeed(val)     { _baseSpeed=Math.max(0.05,val); }
  function setTypeTrim(type, db) {
    if(!type) return;
    const nextDb = Number.isFinite(db) ? db : 0;
    _typeTrimDb.set(type, nextDb);
    _sources.forEach(src => {
      if(src.type !== type || !src.typeGain) return;
      try { src.typeGain.gain.rampTo(_dbToGain(nextDb), 0.25); } catch(e){}
    });
  }
  function getTypeTrim(type) {
    return _trimDbFor(type);
  }
  function getPerfStats() {
    return _capturePerfSnapshot();
  }
  function resetPerfStats() {
    Object.keys(_perfStats).forEach(k => { _perfStats[k] = 0; });
  }
  function isRunning()       { return _running; }
  function getSources()      { return _sources; }
  function startViz()        { _showViz=true; }
  function stopViz()         {
    _showViz=false;
    if(overlay){const o=overlay.getContext('2d');if(o)o.clearRect(0,0,overlay.width,overlay.height);}
  }
  function isVizOn()         { return _showViz; }
  function setSeqViz(on)     { _showSeqViz=on; }
  function isSeqVizOn()      { return _showSeqViz; }

  return {
    start,stop,rebuild,onRebuild,
    setVolume,setPercVolume,setGlueVolume,setSpeed,
    setTypeTrim,getTypeTrim,
    getPerfStats,resetPerfStats,
    isRunning,getSources,
    startViz,stopViz,isVizOn,
    setSeqViz,isSeqVizOn,
    TYPE_COLORS,
  };

})();

// ── audioRebuildIfNeeded — llamado por grilla_ensamble_01.js ─────────────────
function audioRebuildIfNeeded(){
  if(typeof Audio!=='undefined' && Audio.isRunning()) Audio.rebuild();
}
