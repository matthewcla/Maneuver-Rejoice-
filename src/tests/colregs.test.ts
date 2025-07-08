// Jest tests for ColregsBias utilities
import { classifyEncounter, getLegalPreferredVelocity } from '../traffic/ColregsBias';

describe('classifyEncounter', () => {
    test('head-on encounter', () => {
        expect(classifyEncounter(178)).toBe('headOn');
    });

    test('crossing starboard encounter', () => {
        expect(classifyEncounter(45)).toBe('crossingStarboard');
    });

    test('crossing port encounter', () => {
        expect(classifyEncounter(315)).toBe('crossingPort');
    });

    test('overtaking encounter', () => {
        expect(classifyEncounter(200)).toBe('overtaking');
    });
});

describe('getLegalPreferredVelocity', () => {
    const baseVelocity: [number, number] = [1, 0];
    const turnRate = Math.PI / 4; // 45 degrees

    test('rotates to starboard during crossing starboard', () => {
        const v = getLegalPreferredVelocity('crossingStarboard', baseVelocity, turnRate);
        expect(v[0]).toBeCloseTo(Math.cos(-turnRate));
        expect(v[1]).toBeCloseTo(Math.sin(-turnRate));
    });

    test('rotates to starboard during head-on', () => {
        const v = getLegalPreferredVelocity('headOn', baseVelocity, turnRate);
        expect(v[0]).toBeCloseTo(Math.cos(-turnRate));
        expect(v[1]).toBeCloseTo(Math.sin(-turnRate));
    });

    test('maintains course during crossing port', () => {
        const v = getLegalPreferredVelocity('crossingPort', baseVelocity, turnRate);
        expect(v[0]).toBeCloseTo(baseVelocity[0]);
        expect(v[1]).toBeCloseTo(baseVelocity[1]);
    });
});
