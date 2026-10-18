'use strict';

const assert = require('node:assert/strict');
const model = require('../model.js');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

function approx(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label || 'value'}: expected ${expected} +/- ${tolerance}, got ${actual}`
  );
}

test('GT86 defaults reproduce the source geometry and near-understeer balance', () => {
  const r = model.calculate(model.cloneBaseState());
  assert.equal(r.state.massKg, 1285);
  approx(r.state.wheelbaseM, 2.570, 1e-12, 'wheelbase');
  approx(r.state.frontWeight, 0.575, 1e-12, 'front weight');
  approx(r.state.cgHeightM, 0.4226, 1e-9, 'CG height');
  approx(r.staticLoads.frontAxle, 7245.89, 1, 'front static axle load');
  approx(r.staticLoads.rearAxle, 5355.66, 1, 'rear static axle load');
  approx(r.rollStiffness.frontShare, 0.7242, 0.0005, 'front roll share');
  approx(r.rollAngleDeg, 2.62, 0.03, 'roll angle');
  approx(r.grip.front, 8628, 5, 'front grip');
  approx(r.grip.rear, 6612, 5, 'rear grip');
  approx(r.deltaPP, 2.54, 0.05, 'balance delta');
  approx(r.loadTransferRatio.front, 0.2977, 0.001, 'front load-transfer ratio');
  approx(r.loadTransferRatio.rear, 0.1514, 0.001, 'rear load-transfer ratio');
  assert.equal(r.balance, 'understeer');
});

test('front and rear tyre loads add back to their axle static loads when both tyres are on the ground', () => {
  const r = model.calculate(model.cloneBaseState());
  approx(
    r.wheelLoads.frontOuter + r.wheelLoads.frontInner,
    r.staticLoads.frontAxle,
    0.01,
    'front axle load sum'
  );
  approx(
    r.wheelLoads.rearOuter + r.wheelLoads.rearInner,
    r.staticLoads.rearAxle,
    0.01,
    'rear axle load sum'
  );
  approx(
    r.frontLoadTransfer + r.rearLoadTransfer,
    r.mass * r.ay * r.state.cgHeightM * (r.rollStiffness.frontShare / r.state.trackFrontM + (1 - r.rollStiffness.frontShare) / r.state.trackRearM),
    0.01,
    'transfer moment accounting'
  );
});

test('stiffening the front axle lowers front grip and moves balance toward understeer', () => {
  const base = model.cloneBaseState();
  const soft = model.calculate({ ...base, arbFrontNmm: 5 });
  const stiff = model.calculate({ ...base, arbFrontNmm: 70 });
  assert.ok(stiff.frontLoadTransfer > soft.frontLoadTransfer);
  assert.ok(stiff.grip.front < soft.grip.front);
  assert.ok(stiff.grip.rear > soft.grip.rear);
  assert.ok(stiff.deltaPP > soft.deltaPP);
  assert.ok(stiff.rollStiffness.frontShare > soft.rollStiffness.frontShare);
});

test('stiffening the rear axle can move the calibrated model into oversteer', () => {
  const base = model.cloneBaseState();
  const rearStiff = model.calculate({ ...base, arbRearNmm: 40 });
  assert.equal(rearStiff.balance, 'oversteer');
  assert.ok(rearStiff.deltaPP < 0);
  assert.ok(rearStiff.grip.rear < model.calculate(base).grip.rear);
});

test('without load transfer grip loss, axle stiffness distribution cannot change balance', () => {
  const base = model.cloneBaseState();
  const a = model.calculate({ ...base, loadTransferLoss: 0, arbFrontNmm: 0, arbRearNmm: 60 });
  const b = model.calculate({ ...base, loadTransferLoss: 0, arbFrontNmm: 80, arbRearNmm: 0 });
  approx(a.deltaPP, 0, 1e-9, 'soft front delta');
  approx(b.deltaPP, 0, 1e-9, 'stiff front delta');
});

test('the equal-utilisation solver finds a front ARB setting in range', () => {
  const base = model.cloneBaseState();
  const solution = model.solveNeutralFrontArb(base);
  assert.equal(solution.achieved, true);
  assert.ok(solution.value >= 0 && solution.value <= 80);
  approx(solution.deltaPP, 0, 0.05, 'solver residual');
  assert.notEqual(solution.balance, 'understeer');
  assert.notEqual(solution.balance, 'oversteer');
});

test('wheel lift is clamped at zero and raises a warning', () => {
  const base = model.cloneBaseState();
  const r = model.calculate({
    ...base,
    lateralG: 1.4,
    cgHeightM: 0.70,
    trackFrontM: 1.20,
    trackRearM: 1.20,
    frontWeight: 0.40,
    springFrontNmm: 55,
    arbFrontNmm: 80,
    springRearNmm: 8,
    arbRearNmm: 0
  });
  assert.ok(r.wheelLoads.frontInnerRaw < 0 || r.wheelLoads.rearInnerRaw < 0);
  assert.ok(r.wheelLoads.frontInner >= 0);
  assert.ok(r.wheelLoads.rearInner >= 0);
  assert.equal(r.wheelLift.any, true);
  assert.ok(r.warnings.some((warning) => warning.code === 'wheel-lift'));
});

test('high lateral demand raises a total grip warning and limit flag', () => {
  const base = model.cloneBaseState();
  const r = model.calculate({
    ...base,
    lateralG: 1.4,
    tireMuRef: 0.8,
    springFrontNmm: 15,
    springRearNmm: 15,
    arbFrontNmm: 0,
    arbRearNmm: 0
  });
  assert.equal(r.limitExceeded, true);
  assert.ok(r.warnings.some((warning) => warning.code === 'total-grip'));
});

test('roll stiffness sums spring and ARB equivalently and responds to track width', () => {
  const base = model.cloneBaseState();
  const wider = model.calculate({ ...base, trackFrontM: 1.7 });
  const heavierFrontArb = model.calculate({ ...base, arbFrontNmm: 39 + 10 });
  assert.ok(wider.rollStiffness.front > model.calculate(base).rollStiffness.front);
  assert.ok(heavierFrontArb.rollStiffness.front > model.calculate(base).rollStiffness.front);
});

test('corner radius reference is derived from the selected lateral acceleration', () => {
  const base = model.cloneBaseState();
  const r = model.calculate({ ...base, lateralG: 0.85 });
  const expected = Math.pow(100 / 3.6, 2) / (0.85 * 9.80665);
  approx(r.cornerRadiusM, expected, 1e-9, 'reference radius');
});

test('spring-rate inputs accept the higher 200 N/mm adjustment range', () => {
  const base = model.cloneBaseState();
  const r = model.calculate({ ...base, springFrontNmm: 200, springRearNmm: 200 });
  assert.equal(r.state.springFrontNmm, 200);
  assert.equal(r.state.springRearNmm, 200);
  assert.equal(r.springRates.frontNmm, 239);
  assert.equal(r.springRates.rearNmm, 205);
  assert.ok(r.rollStiffness.total > 0);

  const clamped = model.calculate({ ...base, springFrontNmm: 240 });
  assert.equal(clamped.state.springFrontNmm, 200);
});

console.log(`\n${passed} tests passed.`);
