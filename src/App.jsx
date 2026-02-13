import { useState, useEffect, useRef } from 'react';
import puzzles from './puzzles.json';

// --- DETERMINISTIC SHUFFLE ENGINE ---
function seededRandom(seed) {
  return function() {
    var t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

const getMasterPuzzleList = () => {
  const random = seededRandom(42); 
  let ids = puzzles.map(p => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
};

const masterPuzzleList = getMasterPuzzleList();

const getDayIndex = () => {
  const epoch = new Date('2024-01-01T00:00:00').getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0); 
  return Math.floor((today.getTime() - epoch) / 86400000);
};

const getTodaysPuzzles = () => {
  const dayIndex = getDayIndex();
  const todaysIds = [];
  for (let i = 0; i < 5; i++) {
    const index = (dayIndex * 5 + i) % masterPuzzleList.length;
    todaysIds.push(masterPuzzleList[index]);
  }
  return todaysIds;
};

// --- PROCEDURAL AUDIO ENGINE ---
let audioCtx = null;
const initAudio = () => {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
};
const playTone = (frequency, type, duration, vol = 0.1) => {
  initAudio(); 
  if (!audioCtx) return;
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + duration);
};
const sfx = {
  type: () => playTone(800, 'sine', 0.05, 0.02), 
  success: () => {
    playTone(440, 'sine', 0.1, 0.1);
    setTimeout(() => playTone(554, 'sine', 0.1, 0.1), 100);
    setTimeout(() => playTone(659, 'sine', 0.3, 0.1), 200);
  }, 
  error: () => {
    playTone(150, 'sawtooth', 0.2, 0.1);
    setTimeout(() => playTone(100, 'sawtooth', 0.3, 0.1), 100);
  } 
};

// --- SECURITY: HASHING ENGINE ---
async function hashGuess(text) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    return "error";
  }
}

export default function App() {
  const [gameState, setGameState] = useState('landing'); 
  const [puzzlesToday, setPuzzlesToday] = useState(0); 
  const [score, setScore] = useState(0); 
  const [scoreHistory, setScoreHistory] = useState([]); 
  const [todaysPuzzles, setTodaysPuzzles] = useState([]);
  const [guess, setGuess] = useState('');
  const [status, setStatus] = useState('idle'); 
  const [showHint, setShowHint] = useState(false);
  const [showLore, setShowLore] = useState(false); 
  const [attempts, setAttempts] = useState(0); 
  const [copied, setCopied] = useState(false); 
  const [timeLeft, setTimeLeft] = useState(''); 
  const inputRef = useRef(null);

  useEffect(() => {
    const todayStr = new Date().toDateString(); 
    const savedDate = localStorage.getItem('gchq-date');
    const loadedPuzzles = getTodaysPuzzles();
    let savedPuzzlesToday = parseInt(localStorage.getItem('gchq-puzzles-today'), 10) || 0;
    let savedScore = parseInt(localStorage.getItem('gchq-score'), 10) || 0;
    let savedHistory = JSON.parse(localStorage.getItem('gchq-history')) || [];
    
    if (savedDate !== todayStr) {
      savedPuzzlesToday = 0; savedScore = 0; savedHistory = [];
      localStorage.setItem('gchq-date', todayStr);
      localStorage.setItem('gchq-puzzles-today', '0');
      localStorage.setItem('gchq-score', '0');
      localStorage.setItem('gchq-history', JSON.stringify([]));
    }
    
    setTodaysPuzzles(loadedPuzzles);
    setPuzzlesToday(savedPuzzlesToday);
    setScore(savedScore);
    setScoreHistory(savedHistory);
    
    if (savedPuzzlesToday >= 5) setGameState('done_for_day');
    else if (savedPuzzlesToday > 0) setGameState('playing');
  }, []);

  useEffect(() => {
    if (gameState === 'playing' && status === 'idle' && inputRef.current) inputRef.current.focus();
  }, [gameState, status, puzzlesToday]);

  useEffect(() => {
    if (gameState !== 'done_for_day') return;
    const calculateTimeLeft = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setHours(24, 0, 0, 0); 
      const diff = tomorrow - now;
      const h = Math.floor((diff / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
      const m = Math.floor((diff / 1000 / 60) % 60).toString().padStart(2, '0');
      const s = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
      setTimeLeft(`${h}:${m}:${s}`);
    };
    calculateTimeLeft(); 
    const timer = setInterval(calculateTimeLeft, 1000); 
    return () => clearInterval(timer); 
  }, [gameState]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!guess || status === 'checking' || status === 'success') return;
    setStatus('checking');
    const cleanGuess = guess.toLowerCase().replace(/\s/g, '');
    const currentPuzzleId = todaysPuzzles[puzzlesToday];
    const currentPuzzle = puzzles.find(p => p.id === currentPuzzleId);
    const hashedInput = await hashGuess(cleanGuess);
    const isCorrect = currentPuzzle.answerHash ? hashedInput === currentPuzzle.answerHash : cleanGuess === currentPuzzle.answer;
    
    setTimeout(() => {
      if (isCorrect) {
        sfx.success(); setStatus('success');
        const pointsEarned = showHint ? 0 : (attempts === 0 ? 100 : (attempts === 1 ? 75 : (attempts === 2 ? 50 : 25)));
        const newScore = score + pointsEarned;
        const newHistory = [...scoreHistory, pointsEarned];
        const newPuzzlesToday = puzzlesToday + 1;
        localStorage.setItem('gchq-score', newScore);
        localStorage.setItem('gchq-history', JSON.stringify(newHistory));
        localStorage.setItem('gchq-puzzles-today', newPuzzlesToday);
        setTimeout(() => {
          setScore(newScore); setScoreHistory(newHistory); setPuzzlesToday(newPuzzlesToday);
          setGuess(''); setShowHint(false); setAttempts(0); setStatus('idle');
          if (newPuzzlesToday >= 5) setGameState('done_for_day');
        }, 1500);
      } else {
        sfx.error(); setStatus('error'); setAttempts(prev => prev + 1); 
        setTimeout(() => { setStatus('idle'); setGuess(''); }, 800);
      }
    }, 400);
  };

  const handleShare = async () => {
    const dayNum = getDayIndex();
    const blocks = scoreHistory.map(pts => {
      if (pts === 100) return '🟩';
      if (pts === 75) return '🟨';
      if (pts === 50) return '🟧';
      if (pts === 25) return '🟥';
      return '⬛'; 
    }).join('');
    let rank = "Field Agent";
    if (score === 500) rank = "Double-O Status 🕵️‍♂️";
    else if (score >= 400) rank = "Senior Intelligence 🗄️";
    else if (score >= 200) rank = "Field Agent 🏃";
    else rank = "Burn Notice 🚨";
    const shareText = `The Dead Drop - Day ${dayNum}\nRank: ${rank}\nScore: ${score}/500\n\n${blocks}\n\nDecrypt at: secure-terminal.com`;
    if (navigator.share) {
      try { await navigator.share({ title: 'The Dead Drop', text: shareText });
      } catch (err) { console.log("Share canceled", err); }
    } else {
      navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (gameState === 'landing') {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="text-center space-y-8 max-w-lg animate-fade-up z-10 p-8 rounded-3xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm shadow-2xl w-full">
          <div className="space-y-4">
            <span className="text-indigo-500 font-mono tracking-widest text-sm uppercase font-bold">Secure Portal</span>
            <div className="flex items-center justify-center space-x-3 relative">
              <h1 className="text-4xl md:text-5xl font-light tracking-tighter text-white uppercase">The Dead Drop</h1>
              <div className="relative">
                <button onClick={() => setShowLore(!showLore)} className="text-slate-500 hover:text-indigo-400 transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                {showLore && (
                  <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-64 p-4 bg-slate-950 border border-indigo-500/50 rounded-xl shadow-2xl z-50">
                    <p className="text-slate-300 text-sm font-light leading-relaxed text-left">A secret location used in espionage to pass intelligence between operatives without meeting in person.</p>
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-950 border-r border-b border-indigo-500/50 rotate-45"></div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="py-6 border-y border-slate-800/50 text-slate-400 font-light text-lg">Authenticate to decrypt today's 5 intercepted transmissions.</div>
          <button onClick={() => { initAudio(); setGameState('rules'); }} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/20 font-medium tracking-wide text-lg flex justify-center items-center space-x-2">
            <span>Commence Briefing</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
          </button>
        </div>
      </div>
    );
  }

  if (gameState === 'rules') {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="space-y-6 max-w-lg animate-fade-up z-10 p-8 rounded-3xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm shadow-2xl w-full text-left">
          <div className="border-b border-slate-800 pb-4">
            <span className="text-indigo-500 font-mono tracking-widest text-sm uppercase font-bold">Directive 001</span>
            <h2 className="text-3xl font-light tracking-tight text-white mt-1">Operational Guidelines</h2>
          </div>
          <div className="space-y-6 text-slate-300 font-light leading-relaxed">
            <p>Every day at midnight, a new cache of <strong className="text-indigo-400 font-medium">5 encrypted intercepts</strong> is left here. Every operative receives the same puzzles.</p>
            <div className="bg-slate-950/50 p-5 rounded-xl border border-slate-800/50">
              <ul className="space-y-3 font-mono text-sm">
                <li className="flex items-center space-x-3"><span className="w-4 h-4 bg-emerald-500 rounded-sm"></span><span><strong className="text-emerald-400">100 PTS</strong> - First Attempt</span></li>
                <li className="flex items-center space-x-3"><span className="w-4 h-4 bg-yellow-400 rounded-sm"></span><span><strong className="text-yellow-400">75 PTS</strong> - Second Attempt</span></li>
                <li className="flex items-center space-x-3"><span className="w-4 h-4 bg-orange-500 rounded-sm"></span><span><strong className="text-orange-400">50 PTS</strong> - Third Attempt</span></li>
                <li className="flex items-center space-x-3"><span className="w-4 h-4 bg-rose-500 rounded-sm"></span><span><strong className="text-rose-400">25 PTS</strong> - Fourth+ Attempt</span></li>
                <li className="flex items-center space-x-3"><span className="w-4 h-4 bg-slate-800 rounded-sm border border-slate-600"></span><span><strong className="text-slate-400">0 PTS</strong> - Hint Requested</span></li>
              </ul>
            </div>
          </div>
          <button onClick={() => { initAudio(); setGameState('playing'); }} className="w-full mt-4 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium flex justify-center items-center space-x-2">
            <span>Acknowledge & Begin</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>
      </div>
    );
  }

  if (gameState === 'done_for_day') {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 font-sans relative">
        <div className="text-center space-y-6 max-w-md w-full animate-fade-up bg-slate-900/50 pt-10 px-6 sm:px-10 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden">
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
            <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h1 className="text-3xl font-light tracking-tight text-white">Transmission Complete</h1>
          <div className="pt-8 mt-6 border-t border-slate-800 bg-slate-950/80 -mx-6 sm:-mx-10 px-6 sm:px-10 pb-8 flex flex-col items-center">
             <p className="text-slate-500 text-sm uppercase tracking-widest font-bold mb-2">Final Daily Score</p>
             <p className="text-emerald-400 font-mono text-6xl mb-6">{score} <span className="text-3xl text-slate-600">/ 500</span></p>
             <div className="mb-8 w-full bg-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col items-center">
                <span className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Next Intel Drop</span>
                <span className="text-indigo-400 font-mono text-3xl animate-pulse">{timeLeft}</span>
             </div>
             <button onClick={handleShare} className={`w-full mb-4 py-3 rounded-xl transition-all duration-300 font-bold flex justify-center items-center space-x-2 ${copied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'}`}>
                {copied ? <span>Copied!</span> : <><span>Share Results</span><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg></>}
             </button>
             <button onClick={() => setGameState('rules')} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors flex items-center space-x-1">
               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               <span>View Scoring Rules</span>
             </button>
          </div>
        </div>
      </div>
    );
  }

  const currentPuzzleId = todaysPuzzles[puzzlesToday];
  const currentPuzzle = currentPuzzleId ? puzzles.find(p => p.id === currentPuzzleId) : null;
  const currentPuzzleValue = showHint ? 0 : (attempts === 0 ? 100 : (attempts === 1 ? 75 : (attempts === 2 ? 50 : 25)));

  if (!currentPuzzle) return null;

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center justify-center bg-[#0f172a] font-sans">
      <div className="fixed top-0 left-0 w-full bg-slate-900/50 backdrop-blur-md border-b border-slate-800 py-4 px-6 flex justify-center items-center z-50">
        <div className="flex space-x-3">
           {[...Array(5)].map((_, i) => (
             <div key={i} className={`h-2.5 w-10 rounded-full transition-all duration-500 ${i < puzzlesToday ? 'bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.6)]' : i === puzzlesToday ? 'bg-slate-600 animate-pulse' : 'bg-slate-800'}`} />
           ))}
        </div>
      </div>
      <div className="w-full max-w-2xl animate-fade-up bg-slate-900/50 p-8 md:p-12 rounded-2xl border border-slate-800 shadow-2xl mt-12" key={puzzlesToday}>
        <div className="flex justify-between items-center mb-10 border-b border-slate-800 pb-4">
          <span className="text-indigo-400 text-sm font-semibold tracking-widest uppercase flex items-center space-x-3">
            <span>Intel {puzzlesToday + 1}/5</span>
            <span className="text-slate-600">|</span>
            <span className={`transition-colors duration-300 ${currentPuzzleValue === 100 ? 'text-emerald-400' : currentPuzzleValue === 0 ? 'text-rose-500' : 'text-amber-400'}`}>VALUE: {currentPuzzleValue} PTS</span>
          </span>
          <span className="text-slate-500 text-sm font-mono bg-slate-800 px-3 py-1 rounded-md">ID: {currentPuzzle.id.toString().padStart(4, '0')}</span>
        </div>
        <div className="mb-12 space-y-6">
          <h2 className="text-3xl font-medium text-white tracking-tight">{currentPuzzle.title}</h2>
          <div className="text-lg text-slate-300 font-light leading-relaxed whitespace-pre-wrap">{currentPuzzle.text}</div>
        </div>
        <div className="relative mb-8">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input ref={inputRef} type="text" value={guess} onChange={(e) => { if (e.target.value.length > guess.length) sfx.type(); setGuess(e.target.value); }} disabled={status === 'success' || status === 'checking'} className={`w-full bg-slate-950 border-2 rounded-xl pl-6 pr-16 py-4 text-xl font-mono uppercase tracking-[0.2em] outline-none transition-all duration-200 ${status === 'idle' ? 'border-slate-700 text-white focus:border-indigo-500' : ''} ${status === 'error' ? 'border-rose-500 text-rose-400 bg-rose-950/30' : ''} ${status === 'success' ? 'border-emerald-500 text-emerald-400 bg-emerald-950/30' : ''} ${status === 'checking' ? 'border-slate-600 text-slate-500' : ''}`} placeholder="ENTER ANSWER" autoComplete="off" />
            <button type="submit" disabled={!guess || status !== 'idle'} className={`absolute right-3 p-2 rounded-lg transition-colors ${guess && status === 'idle' ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg></button>
          </form>
        </div>
        <div className="flex justify-center h-16 items-center">
          {!showHint ? <button onClick={() => setShowHint(true)} className="text-sm text-slate-500 hover:text-rose-400 transition-colors font-medium tracking-wide flex items-center space-x-2 px-4 py-2 rounded-full hover:bg-slate-800/50"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>Need a hint? (Forfeits points)</span></button> : <div className="text-sm text-amber-200 bg-amber-900/30 px-6 py-4 rounded-xl border border-amber-700/50 w-full text-center font-light shadow-lg"><span className="font-bold text-amber-500 uppercase text-xs tracking-wider block mb-1">Decryption Hint</span>{currentPuzzle.hint}</div>}
        </div>
      </div>
    </div>
  );
}