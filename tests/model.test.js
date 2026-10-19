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
  approx(r.rollStiffness.frontShare, 0.69794, 0.0005, 'front roll share');
  approx(r.rollAngleDeg, 3.124, 0.03, 'roll angle');
  approx(r.grip.front, 8410.1, 1, 'front axle grip');
  approx(r.grip.rear, 6705.9, 1, 'rear axle grip');
  approx(r.deltaPP, 5.349, 0.01, 'balance delta');
  approx(r.loadTransferRatio.front, 0.28685, 0.001, 'front load-transfer ratio');
  approx(r.loadTransferRatio.rear, 0.16578, 0.001, 'rear load-transfer ratio');
  assert.equal(r.balance, 'understeer');
});

test('tyre loads sum to axle loads and wheel couples balance the roll moment', () => {
  const r = model.calculate(model.cloneBaseState());
  const s = r.state;
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

  // The two wheel-load couples must balance the total roll moment. This fails
  // if the per-wheel transfer is divided in half, even though the axle load
  // sums above remain conserved.
  const frontMoment = (r.wheelLoads.frontOuter - r.wheelLoads.frontInner) *
    s.trackFrontM / 2;
  const rearMoment = (r.wheelLoads.rearOuter - r.wheelLoads.rearInner) *
    s.trackRearM / 2;
  approx(
    frontMoment + rearMoment,
    r.totalLateralForce * s.cgHeightM,
    1e-6,
    'wheel-load couples balance the roll moment'
  );
  approx(
    frontMoment,
    r.rollStiffness.frontShare * r.totalLateralForce * s.cgHeightM,
    1e-6,
    'front axle carries its roll-moment share'
  );
  approx(
    r.wheelLoads.frontOuter - r.wheelLoads.frontInner,
    2 * r.frontLoadTransfer,
    1e-6,
    'per-wheel transfer is half the outer-inner difference'
  );
  approx(
    r.wheelLoads.rearOuter - r.wheelLoads.rearInner,
    2 * r.rearLoadTransfer,
    1e-6,
    'rear per-wheel transfer is half the outer-inner difference'
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
    tireLoadSensitivityK: compounds.eco.k,
    tireRearMuRef: compounds.eco.muRef,
    tireRearFz0N: compounds.eco.fz0N,
    tireRearLoadSensitivityK: compounds.eco.k
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
    totalLong * 0.72,
    1e-9,
    '72 % front brake bias'
  );
  approx(
    braking.longitudinalDemand.rear,
    totalLong * 0.28,
    1e-9,
    '28 % rear brake bias'
  );
  approx(braking.longitudinal.brakeBiasFront, 0.72, 1e-12, 'result brake bias');

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

test('AC brake share and drivetrain defaults come from the unpacked car data', () => {
  assert.equal(model.DATA.driveType, 'RWD');
  assert.equal(model.DATA.driveSource, 'drivetrain.ini [TRACTION] TYPE=RWD');
  approx(model.DATA.brakeBiasFront, 0.72, 1e-12, 'brakes.ini front share');
  approx(model.DATA.brakeBiasRear, 0.28, 1e-12, 'brakes.ini rear share');
  assert.equal(model.DATA.cockpitBrakeAdjustable, false);

  const r = model.calculate(model.cloneBaseState());
  assert.equal(r.state.driveType, 'RWD');
  approx(r.state.brakeBiasFront, 0.72, 1e-12, 'state brake bias');
  assert.equal(r.longitudinal.driveType, 'RWD');
  approx(r.longitudinal.driveBiasRear, 1, 1e-12, 'RWD rear share');
  approx(r.longitudinal.brakeBiasRear, 0.28, 1e-12, 'rear brake share in result');
});

test('custom brake bias and FWD / RWD / AWD drive layouts change axle Fx', () => {
  const base = model.cloneBaseState();
  const totalLong = base.massKg * 0.3 * model.G;

  const rwd = model.calculate({ ...base, longitudinalG: 0.3, driveType: 'RWD' });
  const fwd = model.calculate({ ...base, longitudinalG: 0.3, driveType: 'FWD' });
  const awd = model.calculate({ ...base, longitudinalG: 0.3, driveType: 'AWD' });

  approx(rwd.longitudinalDemand.front, 0, 1e-9, 'RWD front drive');
  approx(rwd.longitudinalDemand.rear, totalLong, 1e-9, 'RWD rear drive');
  approx(fwd.longitudinalDemand.front, totalLong, 1e-9, 'FWD front drive');
  approx(fwd.longitudinalDemand.rear, 0, 1e-9, 'FWD rear drive');
  approx(awd.longitudinalDemand.front, totalLong / 2, 1e-9, 'AWD front drive');
  approx(awd.longitudinalDemand.rear, totalLong / 2, 1e-9, 'AWD rear drive');
  assert.equal(fwd.balance, 'understeer');
  assert.equal(rwd.balance, 'oversteer');
  assert.equal(awd.balance, 'understeer');

  const rearBiased = model.calculate({
    ...base,
    lateralG: 0.4,
    longitudinalG: -0.5,
    brakeBiasFront: 0.60
  });
  const frontBiased = model.calculate({
    ...base,
    lateralG: 0.4,
    longitudinalG: -0.5,
    brakeBiasFront: 0.85
  });
  const brakeLong = base.massKg * (-0.5 * model.G);
  approx(
    rearBiased.longitudinalDemand.front,
    brakeLong * 0.60,
    1e-9,
    'custom 60 % front brake'
  );
  approx(
    frontBiased.longitudinalDemand.front,
    brakeLong * 0.85,
    1e-9,
    'custom 85 % front brake'
  );
  assert.equal(rearBiased.balance, 'oversteer');
  assert.equal(frontBiased.balance, 'understeer');
});

test('the nineteen-car garage exposes the unpacked geometry, drivetrain and tyre defaults', () => {
  assert.equal(model.CAR_ORDER.length, 19);
  assert.deepEqual(model.CAR_ORDER.slice(0, 4), ['gt86', 'mx5_nd', 'mx5_cup', 'subaru_22b']);
  assert.deepEqual(model.CAR_ORDER.slice(4), [
    's2000_ap1', 'porsche_911_gt3_cup_2017',
    'porsche_cayman_gt4_clubsport', 'bmw_m3_e92', 'bmw_m4', 'bmw_z4',
    'bmw_z4_gt3', 'ferrari_f2004', 'mercedes_amg_gt3',
    'lotus_exige_v6_cup', 'lotus_exige_240', 'corvette_c6_z06',
    'mazda_rx7_spirit_r', 'honda_civic_type_r_2008', 'toyota_mrs_haru'
  ]);

  const gt86 = model.getCarProfile('gt86');
  approx(gt86.massKg, 1285, 1e-12, 'GT86 mass');
  approx(gt86.wheelbaseM, 2.570, 1e-12, 'GT86 wheelbase');
  approx(gt86.frontWeight, 0.575, 1e-12, 'GT86 front weight');
  approx(gt86.trackFrontM, 1.520, 1e-12, 'GT86 front track');
  approx(gt86.trackRearM, 1.540, 1e-12, 'GT86 rear track');
  approx(gt86.cgHeightM, 0.4226, 1e-9, 'GT86 CG height');
  assert.equal(gt86.driveType, 'RWD');
  approx(gt86.brakeBiasFront, 0.72, 1e-12, 'GT86 brake bias');
  assert.equal(gt86.defaultCompoundId, 'semislicks');
  assert.equal(Object.keys(gt86.tyreCompounds).length, 3);

  const nd = model.getCarProfile('mx5_nd');
  approx(nd.massKg, 1133, 1e-12, 'ND mass');
  approx(nd.wheelbaseM, 2.310, 1e-12, 'ND wheelbase');
  approx(nd.frontWeight, 0.53, 1e-12, 'ND front weight');
  approx(nd.trackFrontM, 1.496, 1e-12, 'ND front track');
  approx(nd.trackRearM, 1.503, 1e-12, 'ND rear track');
  approx(nd.cgHeightM, 0.45815, 1e-9, 'ND CG height');
  approx(nd.springFrontNm / 1000, 11.708, 1e-12, 'ND front spring');
  approx(nd.springRearNm / 1000, 13.417, 1e-12, 'ND rear spring');
  approx(nd.arbFrontNm / 1000, 19, 1e-12, 'ND front ARB');
  approx(nd.arbRearNm / 1000, 4.8, 1e-12, 'ND rear ARB');
  assert.equal(nd.driveType, 'RWD');
  assert.equal(nd.defaultCompoundId, 'semislicks');
  assert.equal(nd.tyreCompounds.street.fz0N, 2517);

  const cup = model.getCarProfile('mx5_cup');
  approx(cup.massKg, 983, 1e-12, 'Cup mass');
  approx(cup.frontWeight, 0.54, 1e-12, 'Cup front weight');
  approx(cup.springFrontNm / 1000, 51, 1e-12, 'Cup front spring');
  approx(cup.springRearNm / 1000, 77, 1e-12, 'Cup rear spring');
  approx(cup.brakeBiasFront, 0.75, 1e-12, 'Cup brake bias');
  assert.equal(cup.defaultCompoundId, 'slicks');
  assert.equal(Object.keys(cup.tyreCompounds).length, 1);
  approx(cup.tyreCompounds.slicks.muRef, 1.46, 1e-12, 'Cup slick mu');
  approx(cup.tyreCompounds.slicks.fz0N, 3045, 1e-12, 'Cup slick FZ0');
  approx(cup.tyreCompounds.slicks.lsExpy, 0.7094, 1e-12, 'Cup slick LS_EXPY');

  const subaru = model.getCarProfile('subaru_22b');
  approx(subaru.massKg, 1297, 1e-12, '22B mass');
  approx(subaru.wheelbaseM, 2.520, 1e-12, '22B wheelbase');
  approx(subaru.frontWeight, 0.63, 1e-12, '22B front weight');
  approx(subaru.trackFrontM, 1.48, 1e-12, '22B front track');
  approx(subaru.cgHeightM, 0.4957, 1e-9, '22B CG height');
  approx(subaru.springRearNm / 1000, 32.757, 1e-12, '22B rear spring');
  approx(subaru.arbFrontNm / 1000, 18.009, 1e-12, '22B front ARB');
  approx(subaru.arbRearNm / 1000, 16.193, 1e-12, '22B rear ARB');
  approx(subaru.brakeBiasFront, 0.78, 1e-12, '22B brake bias');
  assert.equal(subaru.driveType, 'AWD');
  assert.equal(subaru.defaultCompoundId, 'semislicks');

  const s2000 = model.getCarProfile('s2000_ap1');
  approx(s2000.massKg, 1315, 1e-12, 'S2000 mass');
  approx(s2000.wheelbaseM, 2.4, 1e-12, 'S2000 wheelbase');
  approx(s2000.frontWeight, 0.5001, 1e-12, 'S2000 front weight');
  approx(s2000.tyreCompounds.ac0.rear.fz0N, 2767, 1e-12, 'S2000 rear FZ0');

  const cup911 = model.getCarProfile('porsche_911_gt3_cup_2017');
  approx(cup911.frontWeight, 0.38, 1e-12, '911 Cup front weight');
  assert.equal(cup911.frontSuspension.type, 'STRUT');
  assert.equal(cup911.rearSuspension.type, 'DWB');
  assert.equal(cup911.defaultCompoundId, 'ac0', '911 Cup default tyre');

  const f2004 = model.getCarProfile('ferrari_f2004');
  approx(f2004.massKg, 605, 1e-12, 'F2004 mass');
  assert.equal(f2004.defaultCompoundId, 'ac1', 'F2004 default tyre');
  approx(f2004.tyreCompounds.ac1.front.muRef, 1.8, 1e-12, 'F2004 front mu');

  const civic = model.getCarProfile('honda_civic_type_r_2008');
  assert.equal(civic.driveType, 'FWD');
  const mrs = model.getCarProfile('toyota_mrs_haru');
  assert.equal(mrs.frontSuspension.type, 'STRUT');
  assert.equal(mrs.rearSuspension.type, 'STRUT');
  approx(mrs.brakeBiasFront, 0.5, 1e-12, 'MR-S brake bias');

  assert.equal(model.getCarProfile('missing').id, 'gt86');

  const cupState = model.createBaseState('mx5_cup');
  assert.equal(cupState.carId, 'mx5_cup');
  approx(cupState.tireMuRef, 1.46, 1e-12, 'Cup state mu');
  approx(cupState.tireFz0N, 3045, 1e-12, 'Cup state FZ0');
  approx(cupState.tireVerticalRateNm, 202410, 1e-12, 'Cup tyre vertical rate');
  const ecoState = model.createBaseState('gt86', 'eco');
  approx(ecoState.tireMuRef, 1.215, 1e-12, 'GT86 ECO state mu');
  approx(ecoState.tireFz0N, 2274, 1e-12, 'GT86 ECO state FZ0');
  approx(ecoState.tireVerticalRateNm, 263372, 1e-12, 'GT86 ECO vertical rate');
});

test('front and rear AC tyre tables are evaluated independently', () => {
  const profile = model.getCarProfile('porsche_911_gt3_cup_2017');
  const compound = profile.tyreCompounds[profile.defaultCompoundId];
  assert.notEqual(compound.front.fz0N, compound.rear.fz0N);
  assert.notEqual(compound.front.lsExpy, compound.rear.lsExpy);

  const state = model.createBaseState(profile.id);
  approx(state.tireFz0N, compound.front.fz0N, 1e-12, 'front FZ0');
  approx(state.tireRearFz0N, compound.rear.fz0N, 1e-12, 'rear FZ0');
  approx(state.tireWidthM, compound.front.widthM, 1e-12, 'front width');
  approx(state.tireRearWidthM, compound.rear.widthM, 1e-12, 'rear width');

  const result = model.calculate(state);
  const front = result.tyreGrip.frontOuter;
  const rear = result.tyreGrip.rearOuter;
  const expectedFrontMu = compound.front.muRef *
    Math.pow(front.load / compound.front.fz0N, -(1 - compound.front.lsExpy));
  const expectedRearMu = compound.rear.muRef *
    Math.pow(rear.load / compound.rear.fz0N, -(1 - compound.rear.lsExpy));
  approx(front.mu, expectedFrontMu, 1e-12, 'front axle mu');
  approx(rear.mu, expectedRearMu, 1e-12, 'rear axle mu');
  assert.notEqual(front.mu, rear.mu);
});

test('all unpacked tyre compounds expose front and rear spring rates', () => {
  let compoundCount = 0;
  model.CAR_ORDER.forEach((carId) => {
    const profile = model.getCarProfile(carId);
    Object.keys(profile.tyreCompounds).forEach((compoundId) => {
      const compound = profile.tyreCompounds[compoundId];
      compoundCount += 1;
      ['front', 'rear'].forEach((axle) => {
        const spec = compound[axle] || compound;
        assert.equal(
          Number.isFinite(spec.verticalRateNm) && spec.verticalRateNm > 0,
          true,
          `${carId}/${compoundId}/${axle} tyre spring rate`
        );
      });
    });
  });
  assert.equal(compoundCount, 41);
});

test('unpacked AC suspension hardpoints drive each car 3D architecture', () => {
  const gt86 = model.getCarProfile('gt86');
  assert.equal(gt86.frontSuspension.type, 'STRUT');
  assert.equal(gt86.frontSuspension.visualType, 'strut');
  assert.equal(gt86.frontSuspension.springMode, 'strut');
  assert.deepEqual(gt86.frontSuspension.strutCar, [0.2459, 0.4512, -0.0498]);
  assert.deepEqual(gt86.frontSuspension.strutTyre, [0.0881, -0.1182, 0.0093]);
  assert.equal(gt86.rearSuspension.type, 'DWB');
  assert.equal(gt86.rearSuspension.visualType, 'multilink');
  assert.equal(gt86.rearSuspension.springMode, 'derived');
  assert.deepEqual(gt86.rearSuspension.upperFront, [0.4491, 0.0784, 0.1065]);

  ['mx5_nd', 'mx5_cup'].forEach((carId) => {
    const mx5 = model.getCarProfile(carId);
    assert.equal(mx5.frontSuspension.type, 'DWB', carId + ' front raw type');
    assert.equal(mx5.rearSuspension.type, 'DWB', carId + ' rear raw type');
    assert.equal(mx5.frontSuspension.visualType, 'dwb', carId + ' front visual');
    assert.equal(mx5.rearSuspension.visualType, 'dwb', carId + ' rear visual');
    assert.equal(mx5.frontSuspension.springMode, 'derived', carId + ' front spring');
    assert.equal(mx5.rearSuspension.springMode, 'derived', carId + ' rear spring');
    assert.deepEqual(mx5.frontSuspension.tyreTop, [0.15479, 0.10951, -0.0321]);
  });
  const cup = model.getCarProfile('mx5_cup');
  assert.deepEqual(cup.rearSuspension.steerCar, [0.3899, -0.03840, 0.1602]);

  const subaru = model.getCarProfile('subaru_22b');
  assert.equal(subaru.frontSuspension.type, 'STRUT');
  assert.equal(subaru.frontSuspension.visualType, 'strut');
  assert.equal(subaru.frontSuspension.springMode, 'strut');
  // Raw AC rear data is a strut even though the requested visual is multilink.
  assert.equal(subaru.rearSuspension.type, 'STRUT');
  assert.equal(subaru.rearSuspension.visualType, 'multilink');
  assert.equal(subaru.rearSuspension.springMode, 'strut');
  assert.deepEqual(subaru.rearSuspension.strutCar, [0.222, 0.51, 0]);
  assert.deepEqual(subaru.rearSuspension.lowerFront, [0.172, -0.050, 0.514]);

  const pointKeys = [
    'lowerFront', 'lowerRear', 'upperFront', 'upperRear', 'tyreTop',
    'tyreBottom', 'steerCar', 'steerTyre', 'strutCar', 'strutTyre'
  ];
  model.CAR_ORDER.forEach((carId) => {
    const profile = model.getCarProfile(carId);
    ['frontSuspension', 'rearSuspension'].forEach((axleKey) => {
      const axle = profile[axleKey];
      pointKeys.forEach((key) => {
        const point = axle[key];
        if (point === null) {
          return;
        }
        assert.equal(Array.isArray(point), true, `${carId}.${axleKey}.${key} is an array`);
        assert.equal(point.length, 3, `${carId}.${axleKey}.${key} has 3 coordinates`);
        point.forEach((value) => {
          assert.equal(Number.isFinite(value), true, `${carId}.${axleKey}.${key} finite`);
        });
      });
    });
  });
});

test('longitudinal sign classifies the five directional and loss states', () => {
  const classify = model.classifyVehicleState;

  assert.equal(Object.keys(model.VEHICLE_STATES).length, 5);
  assert.equal(classify(0.90, 0.90, 0.50), null);

  assert.equal(classify(1.10, 0.80, 0.50).code, 'power-under');
  assert.equal(classify(0.80, 1.10, 0.50).code, 'power-over');
  assert.equal(classify(1.10, 0.80, -0.50).code, 'front-lock');
  assert.equal(classify(0.80, 1.10, -0.50).code, 'rear-lock');
  // Any non-zero longitudinal sign selects a phase.
  assert.equal(classify(1.10, 0.80, 0.01).code, 'power-under');
  assert.equal(classify(0.80, 1.10, 0.01).code, 'power-over');
  assert.equal(classify(1.10, 0.80, -0.01).code, 'front-lock');
  assert.equal(classify(0.80, 1.10, -0.01).code, 'rear-lock');
  assert.equal(classify(1.10, 0.80, 0), null);
  assert.equal(classify(0.80, 1.10, 0), null);
  assert.equal(classify(1.10, 1.10, 0.50).code, 'loss-of-control');
  assert.equal(classify(1.10, 1.10, -0.50).code, 'loss-of-control');
  assert.equal(classify(1.10, 1.10, 0).code, 'loss-of-control');

  assert.equal(classify(1.10, 0.80, 0.01).labelEn, 'POWER UNDER');
  assert.equal(classify(1.10, 0.80, 0.01).label, '动力推头');
  assert.equal(classify(0.80, 1.10, -0.01).labelEn, 'REAR LOCK');
  assert.equal(classify(0.80, 1.10, -0.50).label, '后轮抱死');

  const straightGrip = model.calculate(model.cloneBaseState());
  assert.equal(straightGrip.vehicleState, null);
});

test('positive lateral G is a right turn and negative lateral G mirrors the loaded side', () => {
  const base = model.cloneBaseState();
  const right = model.calculate({ ...base, lateralG: 0.85 });
  const left = model.calculate({ ...base, lateralG: -0.85 });

  assert.equal(right.turnDirection, 'right');
  assert.equal(left.turnDirection, 'left');
  assert.equal(right.outerSide, 'left');
  assert.equal(left.outerSide, 'right');
  approx(right.grip.front, left.grip.front, 1e-9, 'front grip symmetry');
  approx(right.grip.rear, left.grip.rear, 1e-9, 'rear grip symmetry');
  approx(right.deltaPP, left.deltaPP, 1e-9, 'balance symmetry');
  approx(right.frontLoadTransfer, left.frontLoadTransfer, 1e-9, 'transfer symmetry');
  approx(right.cornerRadiusM, left.cornerRadiusM, 1e-9, 'radius symmetry');

  approx(right.wheelLoads.FL, right.wheelLoads.frontOuter, 1e-9, 'right-turn FL is outer');
  approx(right.wheelLoads.FR, right.wheelLoads.frontInner, 1e-9, 'right-turn FR is inner');
  approx(left.wheelLoads.FL, left.wheelLoads.frontInner, 1e-9, 'left-turn FL is inner');
  approx(left.wheelLoads.FR, left.wheelLoads.frontOuter, 1e-9, 'left-turn FR is outer');
  assert.ok(right.wheelLoads.FL > right.wheelLoads.FR);
  assert.ok(left.wheelLoads.FR > left.wheelLoads.FL);
  approx(right.wheelGrip.FL.capacity, right.tyreGrip.frontOuter.capacity, 1e-9, 'wheel grip FL');
  approx(left.wheelGrip.FR.capacity, left.tyreGrip.frontOuter.capacity, 1e-9, 'wheel grip FR');

  const clamped = model.calculate({ ...base, lateralG: 3, longitudinalG: -3 });
  approx(clamped.state.lateralG, 2, 1e-12, 'lateral clamp');
  approx(clamped.state.longitudinalG, -2, 1e-12, 'longitudinal clamp');
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
    tireRearLoadSensitivityK: 0,
    arbFrontNmm: 0,
    arbRearNmm: 60
  });
  const b = model.calculate({
    ...base,
    tireLoadSensitivityK: 0,
    tireRearLoadSensitivityK: 0,
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

test('wheel lift is clamped at zero and preserves axle normal load', () => {
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
  approx(
    r.wheelLoads.frontOuter + r.wheelLoads.frontInner,
    r.axleLoads.front,
    1e-6,
    'front axle load is preserved after inner-wheel lift'
  );
  approx(
    r.wheelLoads.rearOuter + r.wheelLoads.rearInner,
    r.axleLoads.rear,
    1e-6,
    'rear axle load is preserved after inner-wheel lift'
  );
  assert.ok(r.wheelLoads.frontOuter <= r.axleLoads.front + 1e-9);
  assert.ok(r.wheelLoads.rearOuter <= r.axleLoads.rear + 1e-9);
  approx(
    r.wheelLoads.FL + r.wheelLoads.FR + r.wheelLoads.RL + r.wheelLoads.RR,
    r.mass * model.G,
    1e-6,
    'total normal load equals vehicle weight'
  );
  assert.equal(r.wheelLift.any, true);
  assert.ok(r.warnings.some((warning) => warning.code === 'wheel-lift'));
});

test('extreme longitudinal transfer keeps total normal load at vehicle weight', () => {
  const r = model.calculate({
    ...model.cloneBaseState(),
    lateralG: 0,
    longitudinalG: 2,
    cgHeightM: 0.70,
    wheelbaseM: 2.0,
    frontWeight: 0.30
  });
  approx(
    r.axleLoads.front + r.axleLoads.rear,
    r.mass * model.G,
    1e-6,
    'axle loads sum to vehicle weight'
  );
  approx(
    r.wheelLoads.FL + r.wheelLoads.FR + r.wheelLoads.RL + r.wheelLoads.RR,
    r.mass * model.G,
    1e-6,
    'wheel loads sum to vehicle weight'
  );
  assert.ok(r.axleLoads.front >= 0 && r.axleLoads.rear >= 0);
});

test('tyre spring rate is in series with the suspension wheel rate', () => {
  const base = model.cloneBaseState();
  const r = model.calculate(base);
  const s = r.state;
  const frontSuspensionRate = (s.springFrontNmm + s.arbFrontNmm) * 1000;
  const rearSuspensionRate = (s.springRearNmm + s.arbRearNmm) * 1000;
  const expectedFrontGround =
    (frontSuspensionRate * s.tireVerticalRateNm) /
    (frontSuspensionRate + s.tireVerticalRateNm);
  const expectedRearGround =
    (rearSuspensionRate * s.tireRearVerticalRateNm) /
    (rearSuspensionRate + s.tireRearVerticalRateNm);

  approx(
    r.springRates.groundFrontNmm,
    expectedFrontGround / 1000,
    1e-9,
    'front series ground rate'
  );
  approx(
    r.springRates.groundRearNmm,
    expectedRearGround / 1000,
    1e-9,
    'rear series ground rate'
  );
  approx(
    r.rollStiffness.front,
    expectedFrontGround * s.trackFrontM * s.trackFrontM / 2,
    1e-6,
    'front roll stiffness uses the ground rate'
  );
  approx(
    r.rollStiffness.rear,
    expectedRearGround * s.trackRearM * s.trackRearM / 2,
    1e-6,
    'rear roll stiffness uses the ground rate'
  );
  assert.ok(r.springRates.groundFrontNmm < r.springRates.frontNmm);
  assert.ok(r.springRates.groundRearNmm < r.springRates.rearNmm);

  const softerTyres = model.calculate({
    ...base,
    tireVerticalRateNm: 120000,
    tireRearVerticalRateNm: 120000
  });
  assert.ok(softerTyres.springRates.groundFrontNmm < r.springRates.groundFrontNmm);
  assert.ok(softerTyres.springRates.groundRearNmm < r.springRates.groundRearNmm);
  assert.ok(softerTyres.rollAngleDeg > r.rollAngleDeg);
  assert.ok(
    softerTyres.state.tireVerticalRateNm === 120000 &&
    softerTyres.state.tireRearVerticalRateNm === 120000
  );
});

test('high lateral demand raises a total grip warning and limit flag', () => {
  const base = model.cloneBaseState();
  const r = model.calculate({
    ...base,
    lateralG: 1.4,
    tireMuRef: 0.8,
    tireRearMuRef: 0.8,
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
