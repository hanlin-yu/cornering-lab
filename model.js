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
   *   tyres.ini         default compound index 2 = Semislicks
   *                     RADIUS = 0.3126 m, FZ0 = 2494 N,
   *                     DY_REF = 1.28, LS_EXPY = 0.8119,
   *                     RATE = 262593 N/m
   *
   * The UI uses a transparent, first-order axle grip-loss model. It is a
   * mechanism demonstrator, not a full reconstruction of AC's Pacejka model.
   * The load-transfer loss coefficient is exposed and adjustable.
   */
  var DATA = Object.freeze({
    carId: 'ks_toyota_gt86',
    carName: 'Toyota GT86 / ZN6',
    sourcePath: 'assettocorsa/content/cars/ks_toyota_gt86',
    sourceFile: 'data.acd',
    compound: 'Semislicks',
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
    loadTransferLoss: 0.30,
    lateralG: 0.85
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
    loadTransferLoss: [0, 0.60],
    lateralG: [0.20, 1.40]
  });

  var NEUTRAL_BAND_PP = 0.35;
  var REFERENCE_SPEED_KMH = 100;

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
    var totalLateralForce = mass * ay;

    var frontStaticAxle = mass * G * s.frontWeight;
    var rearStaticAxle = mass * G * (1 - s.frontWeight);
    var frontStaticWheel = frontStaticAxle / 2;
    var rearStaticWheel = rearStaticAxle / 2;

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

    var frontOuterLoadRaw = frontStaticWheel + frontLoadTransfer / 2;
    var frontInnerLoadRaw = frontStaticWheel - frontLoadTransfer / 2;
    var rearOuterLoadRaw = rearStaticWheel + rearLoadTransfer / 2;
    var rearInnerLoadRaw = rearStaticWheel - rearLoadTransfer / 2;

    var frontInnerLoad = Math.max(0, frontInnerLoadRaw);
    var rearInnerLoad = Math.max(0, rearInnerLoadRaw);

    // First-order tyre-load-sensitive axle grip approximation.
    // Base grip is mu * axle normal load. Unequal left/right loading reduces it
    // by loadTransferLoss * (left-right load difference).
    var gripLossFront = s.loadTransferLoss * frontLoadTransfer;
    var gripLossRear = s.loadTransferLoss * rearLoadTransfer;
    var frontGrip = Math.max(0, s.tireMuRef * frontStaticAxle - gripLossFront);
    var rearGrip = Math.max(0, s.tireMuRef * rearStaticAxle - gripLossRear);

    var frontDemand = totalLateralForce * s.frontWeight;
    var rearDemand = totalLateralForce * (1 - s.frontWeight);

    var frontUtil = frontGrip > 0 ? frontDemand / frontGrip : Infinity;
    var rearUtil = rearGrip > 0 ? rearDemand / rearGrip : Infinity;
    var totalGrip = frontGrip + rearGrip;
    var totalUtil = totalGrip > 0 ? totalLateralForce / totalGrip : Infinity;

    var deltaPP = (frontUtil - rearUtil) * 100;
    var balance = 'neutral';
    if (deltaPP > NEUTRAL_BAND_PP) balance = 'understeer';
    else if (deltaPP < -NEUTRAL_BAND_PP) balance = 'oversteer';

    var frontMargin = frontGrip - frontDemand;
    var rearMargin = rearGrip - rearDemand;
    var totalMargin = totalGrip - totalLateralForce;

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
    if (totalLateralForce > totalGrip) {
      warnings.push({
        code: 'total-grip',
        severity: 'danger',
        title: '总抓地力不足',
        detail: '当前设定的前后轴抓地力之和低于该侧向加速度需求。'
      });
    } else if (frontUtil >= 1 || rearUtil >= 1) {
      var saturated = frontUtil >= 1 ? '前轴' : '后轴';
      warnings.push({
        code: 'axle-limit',
        severity: 'warning',
        title: saturated + '达到极限',
        detail: saturated + '抓地力利用率已达到 100%，当前侧向加速度不可持续。'
      });
    }
    if (s.loadTransferLoss < 0.02) {
      warnings.push({
        code: 'low-load-sensitivity',
        severity: 'info',
        title: '载荷敏感度接近零',
        detail: '轮胎抓地力几乎不随载荷转移下降，弹簧/ARB 的平衡作用会非常弱。'
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
      totalLateralForce,
      mass,
      staticLoads: {
        frontAxle: frontStaticAxle,
        rearAxle: rearStaticAxle,
        frontWheel: frontStaticWheel,
        rearWheel: rearStaticWheel
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
      gripLoss: {
        front: gripLossFront,
        rear: gripLossRear
      },
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
      demand: {
        front: frontDemand,
        rear: rearDemand,
        total: totalLateralForce
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
      limitExceeded: totalLateralForce > totalGrip,
      axleLimitReached: frontUtil >= 1 || rearUtil >= 1,
      warnings,
      referenceSpeedKmh: REFERENCE_SPEED_KMH,
      cornerRadiusM
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
