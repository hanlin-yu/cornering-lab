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

test('GT86 defaults reproduce the source geometry and understeer balance', () => {
  const r = model.calculate(model.cloneBaseState());
  assert.equal(r.state.massKg, 1285);
  approx(r.state.wheelbaseM, 2.570, 1e-12, 'wheelbase');
  approx(r.state.frontWeight, 0.575, 1e-12, 'front weight');
  approx(r.state.cgHeightM, 0.4226, 1e-9, 'CG height');
  approx(r.staticLoads.frontAxle, 7245.89, 1, 'front static axle load');
  approx(r.staticLoads.rearAxle, 5355.66, 1, 'rear static axle load');
  approx(r.rollStiffness.frontShare, 0.7242, 0.0005, 'front roll share');
  approx(r.rollAngleDeg, 2.62, 0.03, 'roll angle');
  approx(r.grip.front, 8586.0, 1, 'front axle grip');
  approx(r.grip.rear, 6752.3, 1, 'rear axle grip');
  approx(r.deltaPP, 4.314, 0.01, 'balance delta');
  approx(r.loadTransferRatio.front, 0.2977, 0.001, 'front load-transfer ratio');
  approx(r.loadTransferRatio.rear, 0.1514, 0.001, 'rear load-transfer ratio');
  assert.equal(r.balance, 'understeer');
});

test('front and rear tyre loads add back to their axle loads when both tyres are on the ground', () => {
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

test('each tyre follows the AC load-sensitive power law at its actual Fz', () => {
  const r = model.calculate(model.cloneBaseState());
  const s = r.state;

  function expectedMu(load) {
    return s.tireMuRef * Math.pow(load / s.tireFz0N, -s.tireLoadSensitivityK);
  }

  const outer = r.tyreGrip.frontOuter;
  const inner = r.tyreGrip.rearInner;
  approx(outer.mu, expectedMu(outer.load), 1e-12, 'outer tyre mu');
  approx(inner.mu, expectedMu(inner.load), 1e-12, 'inner tyre mu');
  approx(outer.capacity, outer.mu * outer.load, 1e-9, 'outer tyre capacity');
  approx(inner.capacity, inner.mu * inner.load, 1e-9, 'inner tyre capacity');
  approx(
    r.grip.front,
    r.tyreGrip.frontOuter.capacity + r.tyreGrip.frontInner.capacity,
    1e-9,
    'front grip sums the two tyre capacities'
  );
  approx(
    r.grip.rear,
    r.tyreGrip.rearOuter.capacity + r.tyreGrip.rearInner.capacity,
    1e-9,
    'rear grip sums the two tyre capacities'
  );
});

test('the three AC compounds expose their FZ0, DY_REF, LS_EXPY and derived k', () => {
  const compounds = model.DATA.tyreCompounds;
  assert.equal(model.DATA.defaultCompoundId, 'semislicks');
  approx(compounds.eco.muRef, 1.215, 1e-12, 'ECO mu_ref');
  approx(compounds.eco.fz0N, 2274, 1e-12, 'ECO FZ0');
  approx(compounds.eco.k, 1 - 0.7227, 1e-12, 'ECO k');
  approx(compounds.street.muRef, 1.23, 1e-12, 'Street mu_ref');
  approx(compounds.street.k, 1 - 0.8227, 1e-12, 'Street k');
  approx(compounds.semislicks.muRef, 1.28, 1e-12, 'Semislicks mu_ref');
  approx(compounds.semislicks.fz0N, 2494, 1e-12, 'Semislicks FZ0');
  approx(compounds.semislicks.k, 1 - 0.8119, 1e-12, 'Semislicks k');

  const semislicks = model.BASE_STATE;
  approx(semislicks.tireMuRef, compounds.semislicks.muRef, 1e-12, 'base mu_ref');
  approx(semislicks.tireFz0N, compounds.semislicks.fz0N, 1e-12, 'base FZ0');
  approx(semislicks.tireLoadSensitivityK, compounds.semislicks.k, 1e-12, 'base k');

  const eco = model.calculate({
    ...model.BASE_STATE,
    tireMuRef: compounds.eco.muRef,
    tireFz0N: compounds.eco.fz0N,
    tireLoadSensitivityK: compounds.eco.k
  });
  assert.ok(eco.grip.front < model.calculate(model.BASE_STATE).grip.front);
});

test('longitudinal G moves normal load between the axles and is allocated to drive/brake axes', () => {
  const base = model.cloneBaseState();
  const braking = model.calculate({
    ...base,
    lateralG: 0.4,
    longitudinalG: -0.5
  });
  const totalLong = braking.mass * (-0.5 * model.G);
  approx(
    braking.longitudinal.transfer,
    braking.mass * (-0.5 * model.G) * base.cgHeightM / base.wheelbaseM,
    1e-9,
    'longitudinal transfer'
  );
  approx(
    braking.axleLoads.front,
    braking.staticLoads.frontAxle - braking.longitudinal.transfer,
    0.01,
    'front axle gains load under braking'
  );
  approx(
    braking.axleLoads.rear,
    braking.staticLoads.rearAxle + braking.longitudinal.transfer,
    0.01,
    'rear axle loses load under braking'
  );
  approx(
    braking.wheelLoads.frontOuter + braking.wheelLoads.frontInner,
    braking.axleLoads.front,
    0.01,
    'front wheel loads sum to the transferred axle load'
  );
  approx(
    braking.longitudinalDemand.front,
    totalLong * 0.6,
    1e-9,
    '60 % front brake bias'
  );
  approx(
    braking.longitudinalDemand.rear,
    totalLong * 0.4,
    1e-9,
    '40 % rear brake bias'
  );

  const accelerating = model.calculate({
    ...base,
    lateralG: 0.4,
    longitudinalG: 0.3
  });
  approx(accelerating.longitudinalDemand.front, 0, 1e-9, 'RWD front drive force');
  approx(
    accelerating.longitudinalDemand.rear,
    accelerating.mass * 0.3 * model.G,
    1e-9,
    'RWD rear drive force'
  );
});

test('combined lateral + longitudinal demand moves the balance away from the lateral-only case', () => {
  const base = model.cloneBaseState();
  const lateralOnly = model.calculate(base);
  const powerOn = model.calculate({
    ...base,
    longitudinalG: 0.3
  });
  const trailBraking = model.calculate({
    ...base,
    longitudinalG: -0.5
  });

  assert.equal(lateralOnly.balance, 'understeer');
  assert.equal(powerOn.balance, 'oversteer');
  assert.equal(trailBraking.balance, 'oversteer');
  assert.ok(powerOn.deltaPP < lateralOnly.deltaPP);
  assert.ok(trailBraking.deltaPP < lateralOnly.deltaPP);
  assert.ok(powerOn.utilisation.rear > powerOn.utilisation.front);
  assert.ok(trailBraking.utilisation.rear > trailBraking.utilisation.front);
  approx(
    powerOn.demand.rear,
    Math.hypot(
      powerOn.lateralDemand.rear,
      powerOn.longitudinalDemand.rear
    ),
    1e-9,
    'rear resultant demand'
  );
  approx(
    powerOn.demand.total,
    Math.hypot(
      powerOn.totalLateralForce,
      powerOn.totalLongitudinalForce
    ),
    1e-9,
    'total resultant demand'
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
  assert.equal(stiff.balance, 'understeer');
});

test('rear stiffness reduces understeer at stock weight and can cross into oversteer when front bias is lower', () => {
  const base = model.cloneBaseState();
  const stock = model.calculate(base);
  const rearStiff = model.calculate({ ...base, arbRearNmm: 40 });
  assert.equal(rearStiff.balance, 'understeer');
  assert.ok(rearStiff.deltaPP < stock.deltaPP);
  assert.ok(rearStiff.grip.rear < stock.grip.rear);

  const lessFrontBiased = model.calculate({
    ...base,
    frontWeight: 0.45,
    arbFrontNmm: 0,
    arbRearNmm: 60
  });
  assert.equal(lessFrontBiased.balance, 'oversteer');
  assert.ok(lessFrontBiased.deltaPP < 0);
});

test('with zero tyre load sensitivity, axle stiffness distribution cannot change balance', () => {
  const base = model.cloneBaseState();
  const a = model.calculate({
    ...base,
    tireLoadSensitivityK: 0,
    arbFrontNmm: 0,
    arbRearNmm: 60
  });
  const b = model.calculate({
    ...base,
    tireLoadSensitivityK: 0,
    arbFrontNmm: 80,
    arbRearNmm: 0
  });
  approx(a.deltaPP, 0, 1e-9, 'soft-front delta');
  approx(b.deltaPP, 0, 1e-9, 'stiff-front delta');
  assert.equal(a.balance, 'neutral');
  assert.equal(b.balance, 'neutral');
  assert.ok(a.warnings.some((warning) => warning.code === 'low-load-sensitivity'));
});

test('equal-utilisation solver reports frontier limits honestly', () => {
  const stockSolution = model.solveNeutralFrontArb(model.cloneBaseState());
  assert.equal(stockSolution.achieved, false);
  assert.equal(stockSolution.value, 0);
  assert.ok(stockSolution.deltaPP > 0);
  assert.equal(stockSolution.balance, 'understeer');

  const balancedSolution = model.solveNeutralFrontArb({
    ...model.cloneBaseState(),
    frontWeight: 0.5
  });
  assert.equal(balancedSolution.achieved, true);
  assert.ok(balancedSolution.value >= 0 && balancedSolution.value <= 80);
  approx(balancedSolution.deltaPP, 0, 0.05, 'solver residual');
  assert.equal(balancedSolution.balance, 'neutral');
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
