import { ShipDynamics } from '../Simulator/js/ship-dynamics.js';

const KT_TO_MPS = 0.514444;

test('acceleration limited to 0.07 m/s^2', () => {
    const ship = new ShipDynamics();
    ship.v = 10; // kts
    ship.update(1, 0, 20); // command 20 kts
    const dv = ship.v * KT_TO_MPS - 10 * KT_TO_MPS;
    expect(dv).toBeCloseTo(0.07, 3);
});

test('turn rate follows Nomoto dynamics', () => {
    const ship = new ShipDynamics();
    ship.v = 20;
    ship.update(1, 35, 20);
    expect(ship.r).toBeCloseTo(0.0039, 3);
    expect(ship.psi).toBeCloseTo(0.0039, 3);
});
