import { describe, expect, it } from 'vitest';
import { deriveGameView, gameTurnGuide } from './presentation';
import type { GameThrowInput } from './types';

const ids = ['alex','jamie'];
function throwsFor(segments: string[], playerId = 'alex'): GameThrowInput[] {
  return segments.map((segment,i) => ({id:String(i),playerId,roundNumber:Math.floor(i/3)+1,turnIndex:Math.floor(i/3),dartIndex:i%3+1,segment,scored:0}));
}

describe('party-game turn guidance', () => {
  it('explains the cut-throat objective and unlimited rounds', () => {
    const guide=gameTurnGuide(deriveGameView('cricket',{variant:'cut_throat',maxRounds:null},ids,[]));
    expect(guide.instruction).toContain('Lowest points wins');expect(guide.round).toBe('Round 1');
  });
  it('changes Killer guidance after activation and respects both hit requirements', () => {
    const config={assignedNumbers:{alex:12,jamie:9},killerRequirement:'double',hitToKill:'any',selfHitPenalty:false};
    expect(gameTurnGuide(deriveGameView('killer',config,ids,[])).target).toBe('D12');
    const guide=gameTurnGuide(deriveGameView('killer',config,ids,throwsFor(['D12'])));
    expect(guide.target).toBe('9');expect(guide.instruction).toContain("opponent's number");expect(guide.instruction).not.toContain('Avoid');
    expect(gameTurnGuide(deriveGameView('killer',{...config,hitToKill:'double'},ids,throwsFor(['D12']))).target).toBe('D9');
  });
  it('uses the configured Shanghai start number and wraps the target after twenty', () => {
    const view=deriveGameView('shanghai',{rounds:7,startNumber:20},['alex'],throwsFor(['Miss','Miss','Miss']));
    expect(gameTurnGuide(view).target).toBe('1');expect(gameTurnGuide(view).round).toBe('Round 2 of 7');
  });
  it('shows the inner bull requirement at the end of an Around the World game', () => {
    const view=deriveGameView('around_the_clock',{includeBull:true,bullRequirement:'double',fairFinish:true},['alex'],throwsFor(Array.from({length:20},(_,i)=>`S${i+1}`)));
    const guide=gameTurnGuide(view);expect(guide.target).toBe('DB');expect(guide.instruction).toContain('inner bull');expect(guide.instruction).toContain('fewest darts wins');
  });
  it('rejects invalid persisted configuration instead of rendering a misleading target', () => {
    expect(()=>deriveGameView('shanghai',{rounds:-1},ids,[])).toThrow();
  });
});
