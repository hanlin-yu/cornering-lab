(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CorneringModel = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var G = 9.80665;

  /*
   * Source: Assetto Corsa -> ks_toyota_gt86/data.acd
   *   car.ini           TOTALMASS = 1285 kg (driver, no fuel)
   *   suspensions.ini   WHEELBASE = 2.570 m
   *                     CG_LOCATION = 0.575 (57.5 % front)
   *                     TRACK FRONT/REAR = 1.520 / 1.540 m
   *                     SPRING_RATE = 23000 / 18000 N/m (wheel rate)
   *                     ARB FRONT/REAR = 39000 / 5000 N/m (wheel-rate equivalent)
   *                     BASEY = -0.110 m (both axles)
   *   tyres.ini         RADIUS = 0.3126 m, RATE = 262593 N/m
   *                     default compound index 2 = Semislicks
   *                     front/rear use the same compound parameters.
   *
   * AC load-sensitive tyre curve (no DY_CURVE is present in this car):
   *   k = 1 - LS_EXPY
   *   mu(Fz) = DY_REF * (Fz / FZ0)^(-k)
   *   Fy_max = mu(Fz) * Fz
   * The curve is evaluated per tyre at its actual inner/outer vertical load.
   * When DY_CURVE is present, AC uses that lookup instead of this power law.
   *
   * Two-dimensional G-G extension:
   * - Longitudinal acceleration moves normal load between axles via m*ax*h/L.
   * - RWD drive torque is assigned to the rear axle; braking uses a fixed
   *   60/40 front/rear bias approximation. This is not a slip model: the
   *   allocation still sets each axle's Fx and therefore its combined
   *   utilisation, so it is kept as an explicit modelling assumption.
   * - Lateral and longitudinal demands are combined with a friction circle.
   * - Slip angle and slip ratio are NOT modelled; mu is load-sensitive only.
   */
  var TYRE_COMPOUNDS = {
    eco: {
      id: 'eco',
      name: 'ECO',
      short: 'ECO',
      section: '[ECO] FRONT / REAR',
      muRef: 1.215,
      fz0N: 2274,
      lsExpy: 0.7227,
      k: 1 - 0.7227
    },
    street: {
      id: 'street',
      name: 'Street',
      short: 'STREET',
      section: '[STREET] FRONT_1 / REAR_1',
      muRef: 1.23,
      fz0N: 2274,
      lsExpy: 0.8227,
      k: 1 - 0.8227
    },
    semislicks: {
      id: 'semislicks',
      name: 'Semislicks',
      short: 'SEMISLICKS',
      section: '[SEMISLICKS] FRONT_2 / REAR_2',
      muRef: 1.28,
      fz0N: 2494,
      lsExpy: 0.8119,
      k: 1 - 0.8119
    }
  };

  var DATA = Object.freeze({
    carId: 'ks_toyota_gt86',
    carName: 'Toyota GT86 / ZN6',
    sourcePath: 'assettocorsa/content/cars/ks_toyota_gt86',
    sourceFile: 'data.acd',
    compounds: 'ECO / Street / Semislicks',
    compound: 'Semislicks',
    defaultCompoundId: 'semislicks',
    tyreCompounds: TYRE_COMPOUNDS,
    totalMassKg: 1285,
    wheelbaseM: 2.570,
    cgLocationFront: 0.575,
    trackFrontM: 1.520,
    trackRearM: 1.540,
    baseYFrontM: -0.110,
    baseYRearM: -0.110,
    tyreRadiusM: 0.3126,
    cgHeightM: 0.3126 - (-0.110),
    springFrontNm: 23000,
    springRearNm: 18000,
    arbFrontRaw: 39000,
    arbRearRaw: 5000,
    tyreFz0N: 2494,
    tyreDyRef: 1.28,
    tyreLsExpy: 0.8119,
    tyreVerticalRateNm: 262593,
    defaultArbWheelRateNote:
      'AC/CSP convention interpreted as an equivalent wheel-level rate: 39000 N/m = 39.0 N/mm.'
  });

  var BASE_STATE = Object.freeze({
    massKg: DATA.totalMassKg,
    wheelbaseM: DATA.wheelbaseM,
    frontWeight: DATA.cgLocationFront,
    cgHeightM: DATA.cgHeightM,
    trackFrontM: DATA.trackFrontM,
    trackRearM: DATA.trackRearM,
    springFrontNmm: DATA.springFrontNm / 1000,
    springRearNmm: DATA.springRearNm / 1000,
    arbFrontNmm: DATA.arbFrontRaw / 1000,
    arbRearNmm: DATA.arbRearRaw / 1000,
    tireMuRef: DATA.tyreDyRef,
    tireFz0N: DATA.tyreFz0N,
    tireLoadSensitivityK: 1 - DATA.tyreLsExpy,
    lateralG: 0.85,
    longitudinalG: 0
  });

  var LIMITS = Object.freeze({
    massKg: [900, 1900],
    wheelbaseM: [2.0, 3.4],
    frontWeight: [0.40, 0.66],
    cgHeightM: [0.20, 0.70],
    trackFrontM: [1.20, 1.85],
    trackRearM: [1.20, 1.85],
    springFrontNmm: [8, 200],
    springRearNmm: [8, 200],
    arbFrontNmm: [0, 80],
    arbRearNmm: [0, 60],
    tireMuRef: [0.60, 1.80],
    tireFz0N: [1500, 4000],
    tireLoadSensitivityK: [0, 0.80],
    lateralG: [0.20, 1.40],
    longitudinalG: [-1.20, 0.90]
  });

  var NEUTRAL_BAND_PP = 0.35;
  var REFERENCE_SPEED_KMH = 100;
  // GT86 is rear-drive. Under braking the fixed brake bias is approximated
  // as 60 % front / 40 % rear because brake.ini is not part of this model.
  var BRAKE_BIAS_FRONT = 0.60;
  var DRIVE_BIAS_REAR = 1.0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function cloneBaseState() {
    return Object.assign({}, BASE_STATE);
  }

  function toFiniteNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normaliseState(input) {
    var s = Object.assign({}, BASE_STATE, input || {});
    Object.keys(LIMITS).forEach(function (key) {
      var bounds = LIMITS[key];
      s[key] = clamp(toFiniteNumber(s[key], BASE_STATE[key]), bounds[0], bounds[1]);
    });
    return s;
  }

  function calculate(input) {
    var s = normaliseState(input);

    var mass = s.massKg;
    var ay = s.lateralG * G;
    var ax = s.longitudinalG * G;
    var totalLateralForce = mass * ay;
    var totalLongitudinalForce = mass * ax;

    var frontStaticAxle = mass * G * s.frontWeight;
    var rearStaticAxle = mass * G * (1 - s.frontWeight);
    var frontStaticWheel = frontStaticAxle / 2;
    var rearStaticWheel = rearStaticAxle / 2;

    // Positive ax (forward acceleration) shifts normal load rearward.
    var longitudinalTransfer = mass * ax * s.cgHeightM / s.wheelbaseM;
    var frontAxleLoadRaw = frontStaticAxle - longitudinalTransfer;
    var rearAxleLoadRaw = rearStaticAxle + longitudinalTransfer;
    var frontAxleLoad = Math.max(0, frontAxleLoadRaw);
    var rearAxleLoad = Math.max(0, rearAxleLoadRaw);

    var frontWheelRate = s.springFrontNmm + s.arbFrontNmm;
    var rearWheelRate = s.springRearNmm + s.arbRearNmm;

    // A pair of equal wheel rates contributes (k * track^2 / 2) Nm per radian.
    var frontRollStiffness = frontWheelRate * 1000 * s.trackFrontM * s.trackFrontM / 2;
    var rearRollStiffness = rearWheelRate * 1000 * s.trackRearM * s.trackRearM / 2;
    var totalRollStiffness = frontRollStiffness + rearRollStiffness;
    var frontRollShare = totalRollStiffness > 0 ? frontRollStiffness / totalRollStiffness : 0.5;

    var rollMoment = mass * ay * s.cgHeightM;
    var rollAngleRad = totalRollStiffness > 0 ? rollMoment / totalRollStiffness : 0;
    var rollAngleDeg = rollAngleRad * 180 / Math.PI;

    // Left-hand turn: positive lateral acceleration means load goes to the right.
    var frontLoadTransfer = frontRollShare * rollMoment / s.trackFrontM;
    var rearLoadTransfer = (1 - frontRollShare) * rollMoment / s.trackRearM;

    var frontOuterLoadRaw = frontAxleLoad / 2 + frontLoadTransfer / 2;
    var frontInnerLoadRaw = frontAxleLoad / 2 - frontLoadTransfer / 2;
    var rearOuterLoadRaw = rearAxleLoad / 2 + rearLoadTransfer / 2;
    var rearInnerLoadRaw = rearAxleLoad / 2 - rearLoadTransfer / 2;

    var frontInnerLoad = Math.max(0, frontInnerLoadRaw);
    var rearInnerLoad = Math.max(0, rearInnerLoadRaw);

    // AC load-sensitive tyre curve, evaluated per tyre at its actual Fz.
    // k = 1 - LS_EXPY; mu(Fz) = mu_ref * (Fz / FZ0)^(-k).
    // Fy_max = mu(Fz) * Fz.
    function tyreAtLoad(load) {
      if (!(load > 0)) {
        return { load: 0, mu: 0, capacity: 0 };
      }
      var mu = s.tireMuRef * Math.pow(load / s.tireFz0N, -s.tireLoadSensitivityK);
      return { load, mu, capacity: mu * load };
    }

    var tyreGrip = {
      frontOuter: tyreAtLoad(Math.max(0, frontOuterLoadRaw)),
      frontInner: tyreAtLoad(frontInnerLoad),
      rearOuter: tyreAtLoad(Math.max(0, rearOuterLoadRaw)),
      rearInner: tyreAtLoad(rearInnerLoad)
    };

    var frontGrip = tyreGrip.frontOuter.capacity + tyreGrip.frontInner.capacity;
    var rearGrip = tyreGrip.rearOuter.capacity + tyreGrip.rearInner.capacity;

    var frontLateralDemand = totalLateralForce * s.frontWeight;
    var rearLateralDemand = totalLateralForce * (1 - s.frontWeight);

    // Longitudinal force allocation: RWD drive goes fully to the rear; braking
    // uses the fixed 60/40 front/rear bias approximation documented above.
    var frontLongitudinalDemand;
    var rearLongitudinalDemand;
    if (totalLongitudinalForce >= 0) {
      frontLongitudinalDemand = totalLongitudinalForce * (1 - DRIVE_BIAS_REAR);
      rearLongitudinalDemand = totalLongitudinalForce * DRIVE_BIAS_REAR;
    } else {
      frontLongitudinalDemand = totalLongitudinalForce * BRAKE_BIAS_FRONT;
      rearLongitudinalDemand = totalLongitudinalForce * (1 - BRAKE_BIAS_FRONT);
    }

    // The friction circle makes the resultant demand the correct utilisation
    // numerator: U = sqrt((Fy/Fc)^2 + (Fx/Fc)^2) = |F| / Fc.
    var frontDemand = Math.hypot(frontLateralDemand, frontLongitudinalDemand);
    var rearDemand = Math.hypot(rearLateralDemand, rearLongitudinalDemand);
    var totalDemand = Math.hypot(totalLateralForce, totalLongitudinalForce);

    var totalGrip = frontGrip + rearGrip;
    var frontUtil = frontGrip > 0 ? frontDemand / frontGrip : (frontDemand > 0 ? Infinity : 0);
    var rearUtil = rearGrip > 0 ? rearDemand / rearGrip : (rearDemand > 0 ? Infinity : 0);
    var totalUtil = totalGrip > 0 ? totalDemand / totalGrip : (totalDemand > 0 ? Infinity : 0);

    var deltaPP = (frontUtil - rearUtil) * 100;
    var balance = 'neutral';
    if (deltaPP > NEUTRAL_BAND_PP) balance = 'understeer';
    else if (deltaPP < -NEUTRAL_BAND_PP) balance = 'oversteer';

    var frontMargin = frontGrip - frontDemand;
    var rearMargin = rearGrip - rearDemand;
    var totalMargin = totalGrip - totalDemand;

    var frontWheelLift = frontInnerLoadRaw <= 1e-6;
    var rearWheelLift = rearInnerLoadRaw <= 1e-6;

    var referenceSpeedMs = REFERENCE_SPEED_KMH / 3.6;
    var cornerRadiusM = ay > 0 ? (referenceSpeedMs * referenceSpeedMs) / ay : Infinity;

    var warnings = [];
    if (frontWheelLift || rearWheelLift) {
      var lifted = [];
      if (frontWheelLift) lifted.push('前');
      if (rearWheelLift) lifted.push('后');
      warnings.push({
        code: 'wheel-lift',
        severity: 'danger',
        title: '内侧车轮离地',
        detail: lifted.join('、') + '轴内侧轮已离开地面；线性悬架模型超出有效范围。'
      });
    }
    if (frontAxleLoadRaw <= 1e-6 || rearAxleLoadRaw <= 1e-6) {
      var unloaded = [];
      if (frontAxleLoadRaw <= 1e-6) unloaded.push('前');
      if (rearAxleLoadRaw <= 1e-6) unloaded.push('后');
      warnings.push({
        code: 'axle-unloaded',
        severity: 'danger',
        title: '轴荷转移超出模型范围',
        detail: unloaded.join('、') + '轴垂直载荷已降到零；静态轴荷模型无法继续分配纵向载荷转移。'
      });
    }
    if (totalDemand > totalGrip) {
      warnings.push({
        code: 'total-grip',
        severity: 'danger',
        title: '联合抓地力不足',
        detail: '当前侧向与纵向合力需求已超过前后轴抓地力之和。'
      });
    } else if (frontUtil >= 1 || rearUtil >= 1) {
      var saturated = frontUtil >= 1 ? '前轴' : '后轴';
      warnings.push({
        code: 'axle-limit',
        severity: 'warning',
        title: saturated + '达到极限',
        detail: saturated + '的侧向+纵向联合利用率已达到 100%，当前 G 组合不可持续。'
      });
    }
    if (s.tireLoadSensitivityK < 0.02) {
      warnings.push({
        code: 'low-load-sensitivity',
        severity: 'info',
        title: '轮胎载荷敏感度接近零',
        detail: '当前 k≈0，μ(Fz) 近似为常数；弹簧/ARB 造成的轴荷分配几乎不会改变轴总抓地力。'
      });
    }

    var staticWheelLoadFront = frontStaticWheel;
    var staticWheelLoadRear = rearStaticWheel;
    var tyreDeflectionFrontOuter = Math.max(0, frontOuterLoadRaw) / DATA.tyreVerticalRateNm;
    var tyreDeflectionFrontInner = frontInnerLoad / DATA.tyreVerticalRateNm;
    var tyreDeflectionRearOuter = Math.max(0, rearOuterLoadRaw) / DATA.tyreVerticalRateNm;
    var tyreDeflectionRearInner = rearInnerLoad / DATA.tyreVerticalRateNm;

    return {
      state: s,
      ay,
      ax,
      totalLateralForce,
      totalLongitudinalForce,
      mass,
      staticLoads: {
        frontAxle: frontStaticAxle,
        rearAxle: rearStaticAxle,
        frontWheel: frontStaticWheel,
        rearWheel: rearStaticWheel
      },
      axleLoads: {
        front: frontAxleLoad,
        rear: rearAxleLoad,
        frontRaw: frontAxleLoadRaw,
        rearRaw: rearAxleLoadRaw,
        frontDelta: -longitudinalTransfer,
        rearDelta: longitudinalTransfer
      },
      longitudinal: {
        transfer: longitudinalTransfer,
        rearShare: rearAxleLoad > 0 ? rearAxleLoad / (frontAxleLoad + rearAxleLoad) : 0.5,
        driveBiasRear: DRIVE_BIAS_REAR,
        brakeBiasFront: BRAKE_BIAS_FRONT
      },
      springRates: {
        frontNmm: frontWheelRate,
        rearNmm: rearWheelRate,
        springFrontNmm: s.springFrontNmm,
        springRearNmm: s.springRearNmm,
        arbFrontNmm: s.arbFrontNmm,
        arbRearNmm: s.arbRearNmm
      },
      rollStiffness: {
        front: frontRollStiffness,
        rear: rearRollStiffness,
        total: totalRollStiffness,
        frontShare: frontRollShare,
        rearShare: 1 - frontRollShare
      },
      rollAngleRad,
      rollAngleDeg,
      frontLoadTransfer,
      rearLoadTransfer,
      tyreGrip,
      wheelLoads: {
        frontOuter: frontOuterLoadRaw,
        frontInner: frontInnerLoad,
        rearOuter: rearOuterLoadRaw,
        rearInner: rearInnerLoad,
        frontInnerRaw: frontInnerLoadRaw,
        rearInnerRaw: rearInnerLoadRaw
      },
      tyreDeflection: {
        frontOuter: tyreDeflectionFrontOuter,
        frontInner: tyreDeflectionFrontInner,
        rearOuter: tyreDeflectionRearOuter,
        rearInner: tyreDeflectionRearInner
      },
      grip: {
        front: frontGrip,
        rear: rearGrip,
        total: totalGrip
      },
      lateralDemand: {
        front: frontLateralDemand,
        rear: rearLateralDemand,
        total: totalLateralForce
      },
      longitudinalDemand: {
        front: frontLongitudinalDemand,
        rear: rearLongitudinalDemand,
        total: totalLongitudinalForce
      },
      demand: {
        front: frontDemand,
        rear: rearDemand,
        total: totalDemand
      },
      margin: {
        front: frontMargin,
        rear: rearMargin,
        total: totalMargin
      },
      utilisation: {
        front: frontUtil,
        rear: rearUtil,
        total: totalUtil
      },
      gripShare: {
        front: totalGrip > 0 ? frontGrip / totalGrip : 0.5,
        rear: totalGrip > 0 ? rearGrip / totalGrip : 0.5
      },
      loadTransferRatio: {
        front: frontStaticAxle > 0 ? frontLoadTransfer / frontStaticAxle : 0,
        rear: rearStaticAxle > 0 ? rearLoadTransfer / rearStaticAxle : 0
      },
      balance,
      neutralBandPP: NEUTRAL_BAND_PP,
      deltaPP,
      wheelLift: {
        front: frontWheelLift,
        rear: rearWheelLift,
        any: frontWheelLift || rearWheelLift
      },
      limitExceeded: totalDemand > totalGrip,
      axleLimitReached: frontUtil >= 1 || rearUtil >= 1,
      warnings,
      referenceSpeedKmh: REFERENCE_SPEED_KMH,
      cornerRadiusM,
      gVectorMagnitude: Math.hypot(s.lateralG, s.longitudinalG)
    };
  }

  /*
   * Finds the front ARB wheel rate that puts front/rear utilisation closest to
   * equality at the current cornering condition. Increasing the front ARB
   * always moves the balance toward understeer in this model.
   */
  function solveNeutralFrontArb(input, options) {
    var opts = options || {};
    var min = opts.min != null ? opts.min : LIMITS.arbFrontNmm[0];
    var max = opts.max != null ? opts.max : LIMITS.arbFrontNmm[1];
    var base = normaliseState(input);

    function score(value) {
      return calculate(Object.assign({}, base, { arbFrontNmm: value })).deltaPP;
    }

    var fLow = score(min);
    var fHigh = score(max);
    var value;
    var achieved = true;

    if (fLow * fHigh <= 0) {
      var lo = min;
      var hi = max;
      for (var i = 0; i < 64; i += 1) {
        var mid = (lo + hi) / 2;
        var fMid = score(mid);
        if (fLow * fMid <= 0) {
          hi = mid;
          fHigh = fMid;
        } else {
          lo = mid;
          fLow = fMid;
        }
      }
      value = (lo + hi) / 2;
    } else {
      achieved = false;
      value = Math.abs(fLow) <= Math.abs(fHigh) ? min : max;
    }

    value = Math.round(value * 10) / 10;
    var finalResult = calculate(Object.assign({}, base, { arbFrontNmm: value }));
    return {
      value,
      deltaPP: finalResult.deltaPP,
      balance: finalResult.balance,
      achieved
    };
  }

  return {
    G: G,
    DATA: DATA,
    BASE_STATE: BASE_STATE,
    LIMITS: LIMITS,
    NEUTRAL_BAND_PP: NEUTRAL_BAND_PP,
    cloneBaseState: cloneBaseState,
    normaliseState: normaliseState,
    calculate: calculate,
    solveNeutralFrontArb: solveNeutralFrontArb,
    clamp: clamp
  };
});
