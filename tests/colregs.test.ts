import { ColregsBias, classifyEncounter } from '../src/traffic/ColregsBias';

test('ColregsBias should be instantiable', () => {
    const bias = new ColregsBias(0.1);
    expect(bias).toBeInstanceOf(ColregsBias);
});

test('classifyEncounter correctly categorizes bearings', () => {
    expect(classifyEncounter(0)).toBe('headOn');
    expect(classifyEncounter(10)).toBe('crossingStarboard');
    expect(classifyEncounter(200)).toBe('overtaking');
    expect(classifyEncounter(300)).toBe('crossingPort');
});
