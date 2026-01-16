
import React, { useEffect, useRef } from 'react';
import { Language, GameType } from '../types';
import { getTranslation } from '../utils/i18n';

interface GameModeProps {
  gameType: GameType;
  userInput: string;
  onInputChange: (val: string) => void;
  onConfirm: () => void;
  targetWord: string | null;
  targetSentence: string | null;
  language: Language;
}

export const GameMode: React.FC<GameModeProps> = ({
  gameType,
  userInput,
  onInputChange,
  onConfirm,
  targetWord,
  targetSentence,
  language
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const t = getTranslation(language);

  // Focus input when game target changes
  useEffect(() => {
    if (gameType !== 'none' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [gameType, targetWord, targetSentence]);

  if (gameType === 'none') return null;

  // Validation Logic
  let isCorrect = false;
  
  if (gameType === 'cloze' && targetWord) {
    const cleanInput = userInput.trim().toLowerCase();
    const cleanTarget = targetWord.trim().toLowerCase().replace(/[.,!?;:"()]/g, "");
    isCorrect = cleanInput === cleanTarget;
  } else if (gameType === 'dictation' && targetSentence) {
    const cleanInput = userInput.trim().toLowerCase().replace(/\s+/g, ' ');
    const cleanTarget = targetSentence.trim().toLowerCase().replace(/\s+/g, ' ');
    const stripPunct = (s: string) => s.replace(/[.,!?;:"()]/g, "");
    isCorrect = stripPunct(cleanInput) === stripPunct(cleanTarget);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isCorrect) {
        onConfirm();
      }
    }
  };

  return (
    // Moved to top-20 (just below header) so keyboard doesn't cover subtitles
    <div className="fixed top-20 left-0 right-0 flex justify-center z-40 pointer-events-none px-4">
      <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-indigo-500/50 rounded-xl p-3 shadow-2xl pointer-events-auto flex flex-col items-center gap-2 animate-bounce-in w-full max-w-md transition-colors">
         
         <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${isCorrect ? 'bg-green-500' : 'bg-indigo-500'} animate-pulse`}></span>
            <span className="text-[10px] text-indigo-600 dark:text-indigo-300 uppercase font-bold tracking-widest">
              {gameType === 'cloze' ? t.clozeMode : t.gameDictation}
            </span>
         </div>
         
         <div className="relative w-full">
           <input
             ref={inputRef}
             type="text"
             value={userInput}
             onChange={(e) => onInputChange(e.target.value)}
             onKeyDown={handleKeyDown}
             className={`
               w-full bg-gray-100 dark:bg-slate-800 text-slate-900 dark:text-white text-base font-bold py-2 px-4 rounded-lg border-2 focus:outline-none transition-all text-center
               ${isCorrect 
                  ? 'border-green-500 bg-green-100 dark:bg-green-900/20' 
                  : 'border-indigo-500 focus:border-indigo-400'
               }
             `}
             autoCapitalize="off"
             autoComplete="off"
             autoCorrect="off"
             spellCheck="false"
           />
           {isCorrect && (
             <div className="absolute right-2 top-1/2 -translate-y-1/2 text-green-500 animate-fade-in-up">
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
               </svg>
             </div>
           )}
         </div>
         
         {isCorrect && <p className="text-green-600 dark:text-green-400 text-[10px] font-bold animate-pulse">PRESS ENTER</p>}
      </div>
    </div>
  );
};