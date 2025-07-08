import { ColregsBias } from '../src/traffic/ColregsBias';

test('ColregsBias should be instantiable', () => {
    const bias = new ColregsBias();
    expect(bias).toBeInstanceOf(ColregsBias);
});
