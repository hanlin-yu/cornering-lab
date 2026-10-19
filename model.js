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
   * - Positive lateralG is a right-hand turn; negative is a left-hand turn.
   *   Load-transfer magnitudes use |a_y| and the loaded (outer) side follows
   *   the turn direction.
   * - Longitudinal acceleration moves normal load between axles via m*ax*h/L.
   * - Drive torque follows the selected drivetrain layout (RWD / FWD / AWD).
   * - Brake torque follows the selected front share (default 0.72, from
   *   brakes.ini [DATA] FRONT_SHARE = 0.72; COCKPIT_ADJUSTABLE = 0).
   *   This is not a slip model: the allocation still sets each axle's Fx and
   *   therefore its combined utilisation, so it is an explicit assumption.
   * - Lateral and longitudinal demands are combined with a friction circle.
   * - The tyre vertical RATE is in series with the suspension wheel rate for
   *   the roll-stiffness calculation:
   *   k_ground = 1 / (1 / (k_spring + k_ARB) + 1 / k_tyre).
   * - Slip angle and slip ratio are NOT modelled; mu is load-sensitive only.
   */
  function makeTyreAxleSpec(widthM, radiusM, verticalRateNm, fz0N, muRef, lsExpy) {
    return {
      widthM: widthM,
      radiusM: radiusM,
      verticalRateNm: verticalRateNm,
      fz0N: fz0N,
      muRef: muRef,
      lsExpy: lsExpy,
      k: 1 - lsExpy
    };
  }

  function makeTyreCompound(
    id, index, name, short, section, widthM, radiusM, verticalRateNm,
    fz0N, muRef, lsExpy
  ) {
    var axleSpec = makeTyreAxleSpec(
      widthM, radiusM, verticalRateNm, fz0N, muRef, lsExpy
    );
    return {
      id: id,
      index: index,
      name: name,
      short: short,
      section: section,
      widthM: widthM,
      radiusM: radiusM,
      verticalRateNm: verticalRateNm,
      fz0N: fz0N,
      muRef: muRef,
      lsExpy: lsExpy,
      k: axleSpec.k,
      front: axleSpec,
      rear: axleSpec
    };
  }

  function makeAxleTyreCompound(id, index, name, short, section, front, rear) {
    var frontSpec = makeTyreAxleSpec(
      front[0], front[1], front[2], front[3], front[4], front[5]
    );
    var rearSpec = makeTyreAxleSpec(
      rear[0], rear[1], rear[2], rear[3], rear[4], rear[5]
    );
    return {
      id: id,
      index: index,
      name: name,
      short: short,
      section: section,
      // Front values remain the legacy flat aliases used by custom mode and
      // by callers that only need one representative set of tyre numbers.
      widthM: frontSpec.widthM,
      radiusM: frontSpec.radiusM,
      verticalRateNm: frontSpec.verticalRateNm,
      fz0N: frontSpec.fz0N,
      muRef: frontSpec.muRef,
      lsExpy: frontSpec.lsExpy,
      k: frontSpec.k,
      front: frontSpec,
      rear: rearSpec
    };
  }

  var GT86_TYRE_COMPOUNDS = {
    eco: makeTyreCompound(
      'eco', 0, 'ECO', 'E', '[ECO] FRONT / REAR',
      0.215, 0.3126, 263372, 2274, 1.215, 0.7227
    ),
    street: makeTyreCompound(
      'street', 1, 'Street', 'ST', '[STREET] FRONT_1 / REAR_1',
      0.215, 0.3126, 263372, 2274, 1.23, 0.8227
    ),
    semislicks: makeTyreCompound(
      'semislicks', 2, 'Semislicks', 'SM', '[SEMISLICKS] FRONT_2 / REAR_2',
      0.215, 0.3126, 262593, 2494, 1.28, 0.8119
    )
  };

  var MX5_ND_TYRE_COMPOUNDS = {
    street: makeTyreCompound(
      'street', 0, 'Street', 'ST', '[STREET] FRONT / REAR',
      0.205, 0.30815, 233568, 2517, 1.23, 0.8243
    ),
    semislicks: makeTyreCompound(
      'semislicks', 1, 'Semislicks', 'SM', '[SEMISLICKS] FRONT_1 / REAR_1',
      0.205, 0.30815, 228695, 2737, 1.28, 0.8135
    )
  };

  var MX5_CUP_TYRE_COMPOUNDS = {
    slicks: makeTyreCompound(
      'slicks', 0, 'Slicks', 'H', '[SLICKS] FRONT / REAR',
      0.215, 0.305, 202410, 3045, 1.46, 0.7094
    )
  };

  var SUBARU_22B_TYRE_COMPOUNDS = {
    street: makeTyreCompound(
      'street', 0, 'Street', 'ST', '[STREET] FRONT / REAR',
      0.235, 0.310, 263038, 2590, 1.23, 0.8341
    ),
    semislicks: makeTyreCompound(
      'semislicks', 1, 'Semislicks', 'SM', '[SEMISLICKS] FRONT_1 / REAR_1',
      0.235, 0.310, 277119, 2860, 1.28, 0.84
    )
  };

  var TYRE_COMPOUNDS = GT86_TYRE_COMPOUNDS;

  var S2000_AP1_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "OEM", "ST", "[FRONT] / [REAR]",
      [0.205, 0.316, 233568, 2517, 1.23, 0.8343],
      [0.225, 0.316, 228978, 2767, 1.23, 0.8441]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Semislicks", "SM", "[FRONT_1] / [REAR_1]",
      [0.205, 0.316, 228695, 2617, 1.28, 0.8235],
      [0.225, 0.316, 252831, 2867, 1.28, 0.8333]
    ),
  };

  var PORSCHE_911_GT3_CUP_2017_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Slick Cup", "H", "[FRONT] / [REAR]",
      [0.27, 0.325, 248886, 3447, 1.52, 0.7626],
      [0.31, 0.355, 258074, 3881, 1.52, 0.8095]
    ),
  };

  var PORSCHE_CAYMAN_GT4_CLUBSPORT_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Slick Hard", "H", "[FRONT] / [REAR]",
      [0.25, 0.321, 253784, 3373, 1.52, 0.7513],
      [0.27, 0.3405, 255579, 3618, 1.52, 0.7799]
    ),
  };

  var BMW_M3_E92_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Street", "ST", "[FRONT] / [REAR]",
      [0.245, 0.32705, 321546, 3117, 1.23, 0.8352],
      [0.265, 0.33405, 338920, 3229, 1.23, 0.8482]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Semislicks", "SM", "[FRONT_1] / [REAR_1]",
      [0.245, 0.32705, 284142, 3337, 1.28, 0.8244],
      [0.265, 0.33405, 297632, 3449, 1.28, 0.8374]
    ),
  };

  var BMW_M4_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Street", "ST", "[FRONT] / [REAR]",
      [0.255, 0.33055, 306362, 3142, 1.23, 0.84],
      [0.275, 0.33755, 318547, 3199, 1.23, 0.8515]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Semislick", "SM", "[FRONT_1] / [REAR_1]",
      [0.255, 0.33055, 293197, 3362, 1.28, 0.8292],
      [0.275, 0.33755, 303546, 3419, 1.28, 0.8407]
    ),
  };

  var BMW_Z4_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Street", "ST", "[FRONT] / [REAR]",
      [0.245, 0.32705, 321546, 3117, 1.23, 0.8352],
      [0.265, 0.33405, 338920, 3229, 1.23, 0.8482]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Semislicks", "SM", "[FRONT_1] / [REAR_1]",
      [0.245, 0.32705, 284142, 3337, 1.28, 0.8244],
      [0.265, 0.33405, 297632, 3449, 1.28, 0.8374]
    ),
  };

  var BMW_Z4_GT3_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Slick Soft", "S", "[FRONT] / [REAR]",
      [0.3, 0.34, 272675, 3768, 1.58, 0.7884],
      [0.32, 0.3525, 280112, 3889, 1.58, 0.8022]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Slick Medium", "M", "[FRONT_1] / [REAR_1]",
      [0.3, 0.34, 272675, 3768, 1.56, 0.7884],
      [0.32, 0.3525, 280112, 3889, 1.56, 0.8022]
    ),
    ac2: makeAxleTyreCompound(
      "ac2", 2, "Slick Hard", "H", "[FRONT_2] / [REAR_2]",
      [0.3, 0.34, 272675, 3768, 1.54, 0.7884],
      [0.32, 0.3525, 280112, 3889, 1.54, 0.8022]
    ),
  };

  var FERRARI_F2004_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Slick Soft", "S", "[FRONT] / [REAR]",
      [0.245, 0.33, 203123, 3451, 1.81, 0.8],
      [0.325, 0.33, 272566, 3995, 1.81, 0.7]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Slick Medium", "M", "[FRONT_1] / [REAR_1]",
      [0.245, 0.33, 203123, 3451, 1.8, 0.8],
      [0.325, 0.33, 272566, 3995, 1.8, 0.7]
    ),
    ac2: makeAxleTyreCompound(
      "ac2", 2, "Slick Hard", "H", "[FRONT_2] / [REAR_2]",
      [0.245, 0.33, 203123, 3451, 1.79, 0.8],
      [0.325, 0.33, 272566, 3995, 1.79, 0.7]
    ),
  };

  var MERCEDES_AMG_GT3_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Slick Soft", "S", "[FRONT] / [REAR]",
      [0.315, 0.34, 280470, 3787, 1.58, 0.7917],
      [0.325, 0.3525, 282710, 3910, 1.58, 0.8044]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Slick Medium", "M", "[FRONT_1] / [REAR_1]",
      [0.315, 0.34, 280470, 3787, 1.56, 0.7917],
      [0.325, 0.3525, 282710, 3910, 1.56, 0.8044]
    ),
    ac2: makeAxleTyreCompound(
      "ac2", 2, "Slick Hard", "H", "[FRONT_2] / [REAR_2]",
      [0.315, 0.34, 280470, 3787, 1.54, 0.7917],
      [0.325, 0.3525, 282710, 3910, 1.54, 0.8044]
    ),
  };

  var LOTUS_EXIGE_V6_CUP_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Street", "ST", "[FRONT] / [REAR]",
      [0.205, 0.308, 231507, 2317, 1.26, 0.8179],
      [0.265, 0.321, 271328, 3200, 1.26, 0.8473]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Semislicks", "SM", "[FRONT_1] / [REAR_1]",
      [0.205, 0.308, 240080, 2537, 1.28, 0.8071],
      [0.265, 0.321, 276512, 3420, 1.28, 0.8365]
    ),
  };

  var LOTUS_EXIGE_240_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Street", "ST", "[FRONT] / [REAR]",
      [0.175, 0.301, 198391, 1977, 1.23, 0.8118],
      [0.225, 0.318, 228978, 2465, 1.23, 0.8341]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Semislicks", "SM", "[FRONT_1] / [REAR_1]",
      [0.195, 0.3007, 226220, 2470, 1.28, 0.8124],
      [0.225, 0.31715, 252831, 2685, 1.28, 0.8233]
    ),
  };

  var CORVETTE_C6_Z06_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Eagle F1 Supercar", "ST", "[FRONT] / [REAR]",
      [0.275, 0.3258, 278468, 2741, 1.23, 0.8388],
      [0.325, 0.338, 303968, 3191, 1.23, 0.8638]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Michelin PS2", "ST", "[FRONT_1] / [REAR_1]",
      [0.275, 0.3258, 278468, 3387, 1.23, 0.8502],
      [0.325, 0.338, 303968, 3837, 1.23, 0.8752]
    ),
    ac2: makeAxleTyreCompound(
      "ac2", 2, "Michelin PS CUP ZP", "HR", "[FRONT_2] / [REAR_2]",
      [0.275, 0.3258, 294730, 3562, 1.3, 0.8378],
      [0.325, 0.338, 323440, 4012, 1.3, 0.8628]
    ),
  };

  var MAZDA_RX7_SPIRIT_R_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Street90S", "SV", "[FRONT] / [REAR]",
      [0.235, 0.312, 287430, 2640, 1.21, 0.7442],
      [0.255, 0.3179, 290042, 3136, 1.21, 0.7552]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Street", "ST", "[FRONT_1] / [REAR_1]",
      [0.235, 0.312, 287430, 2640, 1.23, 0.8442],
      [0.255, 0.3179, 290042, 3136, 1.23, 0.8552]
    ),
    ac2: makeAxleTyreCompound(
      "ac2", 2, "Semislicks", "SM", "[FRONT_2] / [REAR_2]",
      [0.235, 0.312, 277119, 2860, 1.28, 0.8334],
      [0.255, 0.3179, 279337, 3356, 1.28, 0.8444]
    ),
  };

  var HONDA_CIVIC_TYPE_R_2008_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Street", "ST", "[FRONT] / [REAR]",
      [0.225, 0.318, 301316, 2465, 1.23, 0.8341],
      [0.225, 0.318, 301316, 2465, 1.23, 0.8341]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "YOKOHAMA AD08R", "SM", "[FRONT_1] / [REAR_1]",
      [0.225, 0.318, 262593, 3157, 1.28, 0.8144],
      [0.225, 0.318, 262593, 3157, 1.28, 0.8144]
    ),
  };

  var TOYOTA_MRS_HARU_TYRE_COMPOUNDS = {
    ac0: makeAxleTyreCompound(
      "ac0", 0, "Advan A052", "ST", "[FRONT] / [REAR]",
      [0.205, 0.295, 252185, 2438, 1.23, 0.793],
      [0.235, 0.31, 270507, 2957, 1.23, 0.8219]
    ),
    ac1: makeAxleTyreCompound(
      "ac1", 1, "Semislicks", "SM", "[FRONT_1] / [REAR_1]",
      [0.205, 0.295, 260194, 2656, 1.28, 0.8082],
      [0.235, 0.31, 278711, 3175, 1.28, 0.8273]
    ),
  };

  var DRIVE_MODES = Object.freeze({
    RWD: { front: 0, rear: 1 },
    FWD: { front: 1, rear: 0 },
    AWD: { front: 0.5, rear: 0.5 }
  });

  var DATA = Object.freeze({
    carId: 'ks_toyota_gt86',
    carName: 'Toyota GT86 / ZN6',
    sourcePath: 'assettocorsa/content/cars/ks_toyota_gt86',
    sourceFile: 'data.acd',
    compounds: 'ECO / Street / Semislicks',
    compound: 'Semislicks',
    defaultCompoundId: 'semislicks',
    tyreCompounds: TYRE_COMPOUNDS,
    driveType: 'RWD',
    driveTypes: ['RWD', 'FWD', 'AWD'],
    driveSource: 'drivetrain.ini [TRACTION] TYPE=RWD',
    brakeBiasFront: 0.72,
    brakeBiasRear: 0.28,
    brakeBiasSource: 'brakes.ini [DATA] FRONT_SHARE = 0.72',
    cockpitBrakeAdjustable: false,
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

  var CAR_PROFILES = {
    gt86: {
      id: 'gt86',
      carId: DATA.carId,
      name: 'Toyota GT86',
      shortName: 'GT86',
      tag: 'ZN6',
      massKg: DATA.totalMassKg,
      wheelbaseM: DATA.wheelbaseM,
      frontWeight: DATA.cgLocationFront,
      trackFrontM: DATA.trackFrontM,
      trackRearM: DATA.trackRearM,
      cgHeightM: DATA.cgHeightM,
      baseYFrontM: DATA.baseYFrontM,
      baseYRearM: DATA.baseYRearM,
      springFrontNm: DATA.springFrontNm,
      springRearNm: DATA.springRearNm,
      arbFrontNm: DATA.arbFrontRaw,
      arbRearNm: DATA.arbRearRaw,
      tyreCompounds: GT86_TYRE_COMPOUNDS,
      defaultCompoundId: DATA.defaultCompoundId,
      brakeBiasFront: DATA.brakeBiasFront,
      cockpitBrakeAdjustable: DATA.cockpitBrakeAdjustable,
      driveType: DATA.driveType,
      brakeSource: DATA.brakeBiasSource,
      driveSource: DATA.driveSource,
      frontSuspension: {
        type: 'STRUT',
        name: '麦弗逊支柱',
        visualType: 'strut',
        springMode: 'strut',
        lowerFront: [0.3722, -0.0995, 0.308],
        lowerRear: [0.4038, -0.1045, -0.0424],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.0881, -0.1182, 0.0093],
        steerCar: [0.5833, -0.0917, -0.1417],
        steerTyre: [0.1088, -0.1182, -0.1304],
        strutCar: [0.2459, 0.4512, -0.0498],
        strutTyre: [0.0881, -0.1182, 0.0093]
      },
      rearSuspension: {
        type: 'DWB',
        name: '多连杆',
        visualType: 'multilink',
        springMode: 'derived',
        upperFront: [0.4491, 0.0784, 0.1065],
        upperRear: [0.497, 0.0767, -0.0601],
        lowerFront: [0.2861, -0.093, 0.2345],
        lowerRear: [0.5945, -0.1058, -0.1439],
        tyreTop: [0.1877, 0.1374, 0.0574],
        tyreBottom: [0.1485, -0.1278, -0.0422],
        steerCar: [0.4254, -0.0586, 0.1373],
        steerTyre: [0.1724, -0.064, 0.1362],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: DATA.sourcePath,
      sourceFile: DATA.sourceFile
    },
    mx5_nd: {
      id: 'mx5_nd',
      carId: 'ks_mazda_mx5_nd',
      name: 'Mazda MX-5 ND',
      shortName: 'MX-5 ND',
      tag: 'ND',
      massKg: 1133,
      wheelbaseM: 2.310,
      frontWeight: 0.53,
      trackFrontM: 1.496,
      trackRearM: 1.503,
      cgHeightM: 0.30815 - (-0.15),
      baseYFrontM: -0.15,
      baseYRearM: -0.15,
      springFrontNm: 11708,
      springRearNm: 13417,
      arbFrontNm: 19000,
      arbRearNm: 4800,
      tyreCompounds: MX5_ND_TYRE_COMPOUNDS,
      defaultCompoundId: 'semislicks',
      brakeBiasFront: 0.72,
      cockpitBrakeAdjustable: false,
      driveType: 'RWD',
      brakeSource: 'brakes.ini [DATA] FRONT_SHARE = 0.72',
      driveSource: 'drivetrain.ini [TRACTION] TYPE=RWD',
      frontSuspension: {
        type: 'DWB',
        name: '双叉臂',
        visualType: 'dwb',
        springMode: 'derived',
        upperFront: [0.38302, 0.12311, 0.1348],
        upperRear: [0.38302, 0.12451, -0.1669],
        lowerFront: [0.4552, -0.0696, -0.0333],
        lowerRear: [0.4259, -0.08110, -0.39616],
        tyreTop: [0.15479, 0.10951, -0.0321],
        tyreBottom: [0.1005, -0.10102, -0.0025],
        steerCar: [0.4552, -0.0296, 0.0589],
        steerTyre: [0.0948, -0.06012, 0.11691],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: 'DWB',
        name: '双叉臂',
        visualType: 'dwb',
        springMode: 'derived',
        upperFront: [0.39022, 0.08701, 0.04129],
        upperRear: [0.42022, 0.09469, -0.24111],
        lowerFront: [0.44100, -0.07010, 0.22113],
        lowerRear: [0.44042, -0.08989, -0.10935],
        tyreTop: [0.1100, 0.1122, 0],
        tyreBottom: [0.0913, -0.10511, -0.0100],
        steerCar: [0.3899, -0.04540, 0.1602],
        steerTyre: [0.0913, -0.05342, 0.14988],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: 'assettocorsa/content/cars/ks_mazda_mx5_nd',
      sourceFile: 'data.acd'
    },
    mx5_cup: {
      id: 'mx5_cup',
      carId: 'ks_mazda_mx5_cup',
      name: 'Mazda MX-5 Cup',
      shortName: 'MX-5 Cup',
      tag: 'CUP',
      massKg: 983,
      wheelbaseM: 2.310,
      frontWeight: 0.54,
      trackFrontM: 1.525,
      trackRearM: 1.510,
      cgHeightM: 0.305 - (-0.15),
      baseYFrontM: -0.15,
      baseYRearM: -0.15,
      springFrontNm: 51000,
      springRearNm: 77000,
      arbFrontNm: 39000,
      arbRearNm: 4800,
      tyreCompounds: MX5_CUP_TYRE_COMPOUNDS,
      defaultCompoundId: 'slicks',
      brakeBiasFront: 0.75,
      cockpitBrakeAdjustable: false,
      driveType: 'RWD',
      brakeSource: 'brakes.ini [DATA] FRONT_SHARE = 0.75',
      driveSource: 'drivetrain.ini [TRACTION] TYPE=RWD',
      frontSuspension: {
        type: 'DWB',
        name: '双叉臂',
        visualType: 'dwb',
        springMode: 'derived',
        upperFront: [0.38302, 0.12311, 0.1348],
        upperRear: [0.38302, 0.12451, -0.1669],
        lowerFront: [0.4552, -0.0696, -0.0333],
        lowerRear: [0.4259, -0.08110, -0.39616],
        tyreTop: [0.15479, 0.10951, -0.0321],
        tyreBottom: [0.1005, -0.10102, -0.0025],
        steerCar: [0.4552, -0.0296, 0.0589],
        steerTyre: [0.0948, -0.06012, 0.11691],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: 'DWB',
        name: '双叉臂',
        visualType: 'dwb',
        springMode: 'derived',
        upperFront: [0.39022, 0.08701, 0.04129],
        upperRear: [0.42022, 0.09469, -0.24111],
        lowerFront: [0.44100, -0.07010, 0.22113],
        lowerRear: [0.44042, -0.08989, -0.10935],
        tyreTop: [0.1100, 0.1122, 0],
        tyreBottom: [0.0913, -0.10511, -0.0100],
        steerCar: [0.3899, -0.03840, 0.1602],
        steerTyre: [0.0913, -0.05342, 0.14988],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: 'assettocorsa/content/cars/ks_mazda_mx5_cup',
      sourceFile: 'data.acd'
    },
    subaru_22b: {
      id: 'subaru_22b',
      carId: 'ddm_subaru_22b',
      name: 'Subaru Impreza 22B',
      shortName: '22B STi',
      tag: '22B',
      massKg: 1297,
      wheelbaseM: 2.520,
      frontWeight: 0.63,
      trackFrontM: 1.480,
      trackRearM: 1.500,
      cgHeightM: 0.4957,
      baseYFrontM: -0.19,
      baseYRearM: -0.18,
      springFrontNm: 35640,
      springRearNm: 32757,
      arbFrontNm: 18009,
      arbRearNm: 16193,
      tyreCompounds: SUBARU_22B_TYRE_COMPOUNDS,
      defaultCompoundId: 'semislicks',
      brakeBiasFront: 0.78,
      cockpitBrakeAdjustable: false,
      driveType: 'AWD',
      brakeSource: 'brakes.ini [DATA] FRONT_SHARE = 0.78',
      driveSource: 'drivetrain.ini [TRACTION] TYPE=AWD',
      frontSuspension: {
        type: 'STRUT',
        name: '麦弗逊支柱',
        visualType: 'strut',
        springMode: 'strut',
        lowerFront: [0.396, -0.100, 0.040],
        lowerRear: [0.366, -0.100, -0.314],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.057, -0.132, 0.013],
        steerCar: [0.420, -0.046, 0.104],
        steerTyre: [0.049, -0.069, 0.124],
        strutCar: [0.222, 0.497, -0.021],
        strutTyre: [0.057, -0.132, 0.013]
      },
      rearSuspension: {
        type: 'STRUT',
        name: '多连杆',
        visualType: 'multilink',
        springMode: 'strut',
        lowerFront: [0.172, -0.050, 0.514],
        lowerRear: [0.515, -0.045, 0.072],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.108, -0.080, 0.072],
        steerCar: [0.515, -0.045, -0.120],
        steerTyre: [0.108, -0.080, -0.120],
        strutCar: [0.222, 0.510, 0],
        strutTyre: [0.108, -0.080, 0]
      },
      sourcePath: 'assettocorsa/content/cars/ddm_subaru_22b',
      sourceFile: 'data.acd'
    },
    s2000_ap1: {
      id: "s2000_ap1",
      carId: "ddm_honda_s2000_ap1",
      name: "Honda S2000 AP1",
      shortName: "S2000 AP1",
      tag: "AP1",
      massKg: 1315,
      wheelbaseM: 2.4,
      frontWeight: 0.5001,
      trackFrontM: 1.47,
      trackRearM: 1.51,
      cgHeightM: 0.4775,
      baseYFrontM: -0.162,
      baseYRearM: -0.161,
      springFrontNm: 23063,
      springRearNm: 30445,
      arbFrontNm: 16660,
      arbRearNm: 8798,
      tyreCompounds: S2000_AP1_TYRE_COMPOUNDS,
      defaultCompoundId: "ac0",
      brakeBiasFront: 0.62,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.62 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.315, -0.095, 0.011],
        lowerRear: [0.315, -0.095, -0.276],
        upperFront: [0.268, 0.135, 0.092],
        upperRear: [0.268, 0.113, -0.122],
        tyreTop: [0.07, 0.133, -0.028],
        tyreBottom: [0.031, -0.098, -0.004],
        steerCar: [0.305, -0.016, 0.0904],
        steerTyre: [0.025, -0.016, 0.142],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.37, -0.018, 0.291],
        lowerRear: [0.37, -0.085, -0.164],
        upperFront: [0.256, 0.128, 0.175],
        upperRear: [0.256, 0.128, -0.005],
        tyreTop: [0.04, 0.145, 0.03],
        tyreBottom: [0.01, -0.082, -0.104],
        steerCar: [0.318, -0.083, 0.174],
        steerTyre: [0.04, -0.102, 0.093],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/ddm_honda_s2000_ap1",
      sourceFile: "data.acd"
    },
    porsche_911_gt3_cup_2017: {
      id: "porsche_911_gt3_cup_2017",
      carId: "ks_porsche_911_gt3_cup_2017",
      name: "Porsche 911 GT3 Cup 2017",
      shortName: "911 GT3 Cup",
      tag: "GT3C",
      massKg: 1300,
      wheelbaseM: 2.458,
      frontWeight: 0.38,
      trackFrontM: 1.57,
      trackRearM: 1.55,
      cgHeightM: 0.4753,
      baseYFrontM: -0.11,
      baseYRearM: -0.145,
      springFrontNm: 61816,
      springRearNm: 56567,
      arbFrontNm: 33547,
      arbRearNm: 15723,
      tyreCompounds: PORSCHE_911_GT3_CUP_2017_TYRE_COMPOUNDS,
      defaultCompoundId: "ac0",
      brakeBiasFront: 0.62,
      cockpitBrakeAdjustable: true,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.62 \u00b7 COCKPIT_ADJUSTABLE = 1",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.43404, -0.09653, 0.26336],
        lowerRear: [0.405701, -0.08452, -0.00969],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.10244, -0.12762, 0.02208],
        steerCar: [0.4833, -0.017, 0.11086],
        steerTyre: [0.0993, -0.04109, 0.15048],
        strutCar: [0.30577, 0.4337, -0.06593],
        strutTyre: [0.102438, -0.12762, 0.02208]
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.47358, -0.114082, 0.282403],
        lowerRear: [0.554202, -0.12108, -0.089746],
        upperFront: [0.396, 0.1816, 0.126],
        upperRear: [0.413292, 0.184239, -0.124575],
        tyreTop: [0.06696, 0.141288, -0.138677],
        tyreBottom: [0.08446, -0.187052, -0.106867],
        steerCar: [0.396, 0.1476, 0.126],
        steerTyre: [0.06696, 0.101288, 0.126],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/ks_porsche_911_gt3_cup_2017",
      sourceFile: "data.acd"
    },
    porsche_cayman_gt4_clubsport: {
      id: "porsche_cayman_gt4_clubsport",
      carId: "ks_porsche_cayman_gt4_clubsport",
      name: "Porsche Cayman GT4 Clubsport",
      shortName: "Cayman GT4 CS",
      tag: "GT4",
      massKg: 1375,
      wheelbaseM: 2.484,
      frontWeight: 0.46,
      trackFrontM: 1.539,
      trackRearM: 1.533,
      cgHeightM: 0.44733,
      baseYFrontM: -0.105,
      baseYRearM: -0.125,
      springFrontNm: 165000,
      springRearNm: 170000,
      arbFrontNm: 32000,
      arbRearNm: 20000,
      tyreCompounds: PORSCHE_CAYMAN_GT4_CLUBSPORT_TYRE_COMPOUNDS,
      defaultCompoundId: "ac0",
      brakeBiasFront: 0.68,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.68 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.438, -0.16775, 0.26073],
        lowerRear: [0.41057, -0.15672, -0.0128],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.10784, -0.16402, 0.01798],
        steerCar: [0.48843, -0.08289, 0.10865],
        steerTyre: [0.09707, -0.08479, 0.14781],
        strutCar: [0.28497, 0.40218, -0.08294],
        strutTyre: [0.10784, -0.16402, 0.01798]
      },
      rearSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.2688, -0.0641, 0.6175],
        lowerRear: [0.4054, -0.1744, -0.0565],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.1106, -0.1804, 0.0095],
        steerCar: [0.541, -0.1257, -0.195],
        steerTyre: [0.2082, -0.1121, -0.2028],
        strutCar: [0.3355, 0.4601, -0.0506],
        strutTyre: [0.1106, -0.1804, 0.0095]
      },
      sourcePath: "assettocorsa/content/cars/ks_porsche_cayman_gt4_clubsport",
      sourceFile: "data.acd"
    },
    bmw_m3_e92: {
      id: "bmw_m3_e92",
      carId: "bmw_m3_e92",
      name: "BMW M3 E92",
      shortName: "M3 E92",
      tag: "E92",
      massKg: 1680,
      wheelbaseM: 2.76098,
      frontWeight: 0.5155,
      trackFrontM: 1.53924,
      trackRearM: 1.53924,
      cgHeightM: 0.458019,
      baseYFrontM: -0.13,
      baseYRearM: -0.125,
      springFrontNm: 28000,
      springRearNm: 37000,
      arbFrontNm: 20000,
      arbRearNm: 6800,
      tyreCompounds: BMW_M3_E92_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.665,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.665 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.41, -0.16, 0.325],
        lowerRear: [0.39, -0.155, -0.04],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.052, -0.15, 0.015],
        steerCar: [0.378, -0.093, 0.06],
        steerTyre: [0.04, -0.09, 0.15],
        strutCar: [0.16, 0.405, -0.0534],
        strutTyre: [0.052, -0.15, 0.015]
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.55241, -0.13704, 0.25301],
        lowerRear: [0.62752, -0.15959, -0.21499],
        upperFront: [0.55028, 0.10705, 0.2637],
        upperRear: [0.51895, 0.11103, -0.21603],
        tyreTop: [0.09214, 0.15412, 0.03682],
        tyreBottom: [0.07903, -0.162, -0.07547],
        steerCar: [0.62752, -0.08479, -0.20301],
        steerTyre: [0.07903, -0.073, -0.10484],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/bmw_m3_e92",
      sourceFile: "data.acd"
    },
    bmw_m4: {
      id: "bmw_m4",
      carId: "ks_bmw_m4",
      name: "BMW M4",
      shortName: "M4",
      tag: "M4",
      massKg: 1647,
      wheelbaseM: 2.812,
      frontWeight: 0.52,
      trackFrontM: 1.58,
      trackRearM: 1.6,
      cgHeightM: 0.44851,
      baseYFrontM: -0.105,
      baseYRearM: -0.125,
      springFrontNm: 32760,
      springRearNm: 34500,
      arbFrontNm: 36000,
      arbRearNm: 8000,
      tyreCompounds: BMW_M4_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.71,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.71 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.42459, -0.07639, 0.27323],
        lowerRear: [0.43308, -0.13122, -0.05298],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.12495, -0.10138, 0.00281],
        steerCar: [0.43981, -0.11922, 0.06899],
        steerTyre: [0.10431, -0.09843, 0.06899],
        strutCar: [0.24083, 0.46361, -0.07195],
        strutTyre: [0.12495, -0.10138, 0.00281]
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.40542, -0.1049, 0.24865],
        lowerRear: [0.55424, -0.11491, -0.15625],
        upperFront: [0.36334, 0.05514, 0.18607],
        upperRear: [0.41921, 0.07956, -0.02748],
        tyreTop: [0.13344, 0.09251, 0.03711],
        tyreBottom: [0.13509, -0.12886, -0.01624],
        steerCar: [0.52136, -0.04532, -0.20682],
        steerTyre: [0.14284, -0.05236, -0.17389],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/ks_bmw_m4",
      sourceFile: "data.acd"
    },
    bmw_z4: {
      id: "bmw_z4",
      carId: "bmw_z4",
      name: "BMW Z4",
      shortName: "Z4",
      tag: "Z4",
      massKg: 1680,
      wheelbaseM: 2.495,
      frontWeight: 0.515,
      trackFrontM: 1.512,
      trackRearM: 1.537,
      cgHeightM: 0.48802,
      baseYFrontM: -0.16,
      baseYRearM: -0.155,
      springFrontNm: 26760,
      springRearNm: 37000,
      arbFrontNm: 17000,
      arbRearNm: 8000,
      tyreCompounds: BMW_Z4_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.7,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.7 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.41, -0.157, 0.325],
        lowerRear: [0.39, -0.15, -0.04],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.052, -0.15, 0.015],
        steerCar: [0.378, -0.1, 0.06],
        steerTyre: [0.04, -0.08, 0.15],
        strutCar: [0.16, 0.385, -0.0533],
        strutTyre: [0.052, -0.15, 0.015]
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.55241, -0.13704, 0.25301],
        lowerRear: [0.62752, -0.15959, -0.21499],
        upperFront: [0.55028, 0.10705, 0.2637],
        upperRear: [0.51895, 0.11103, -0.21603],
        tyreTop: [0.09214, 0.15412, 0.03682],
        tyreBottom: [0.07903, -0.162, -0.07547],
        steerCar: [0.62752, -0.08479, -0.20301],
        steerTyre: [0.07903, -0.073, -0.10484],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/bmw_z4",
      sourceFile: "data.acd"
    },
    bmw_z4_gt3: {
      id: "bmw_z4_gt3",
      carId: "bmw_z4_gt3",
      name: "BMW Z4 GT3",
      shortName: "Z4 GT3",
      tag: "GT3",
      massKg: 1305,
      wheelbaseM: 2.51,
      frontWeight: 0.53,
      trackFrontM: 1.623,
      trackRearM: 1.667,
      cgHeightM: 0.413525,
      baseYFrontM: -0.07,
      baseYRearM: -0.065,
      springFrontNm: 170000,
      springRearNm: 75000,
      arbFrontNm: 55000,
      arbRearNm: 22000,
      tyreCompounds: BMW_Z4_GT3_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.72,
      cockpitBrakeAdjustable: true,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.72 \u00b7 COCKPIT_ADJUSTABLE = 1",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.41, -0.157, 0.325],
        lowerRear: [0.39, -0.15, -0.04],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.052, -0.15, 0.015],
        steerCar: [0.378, -0.1, 0.06],
        steerTyre: [0.04, -0.09, 0.15],
        strutCar: [0.18, 0.39, -0.056],
        strutTyre: [0.052, -0.15, 0.015]
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.37702, -0.11686, 0.3042],
        lowerRear: [0.47702, -0.11686, -0.1154],
        upperFront: [0.34842, 0.0827, 0.2214],
        upperRear: [0.418, 0.0744, 0.0308],
        tyreTop: [0.06622, 0.0957, -0.0065],
        tyreBottom: [0.04602, -0.12706, 0.0187],
        steerCar: [0.48002, -0.07406, -0.1054],
        steerTyre: [0.04602, -0.07406, -0.0454],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/bmw_z4_gt3",
      sourceFile: "data.acd"
    },
    ferrari_f2004: {
      id: "ferrari_f2004",
      carId: "ks_ferrari_f2004",
      name: "Ferrari F2004",
      shortName: "F2004",
      tag: "F04",
      massKg: 605,
      wheelbaseM: 3.05,
      frontWeight: 0.448,
      trackFrontM: 1.47,
      trackRearM: 1.405,
      cgHeightM: 0.27416,
      baseYFrontM: 0.1,
      baseYRearM: 0.02,
      springFrontNm: 40000,
      springRearNm: 60000,
      arbFrontNm: 40000,
      arbRearNm: 15000,
      tyreCompounds: FERRARI_F2004_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.55,
      cockpitBrakeAdjustable: true,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.55 \u00b7 COCKPIT_ADJUSTABLE = 1",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.7827, -0.1233, 0.01249],
        lowerRear: [0.7789, -0.1217, -0.4213],
        upperFront: [0.6554, 0.08421, 0.04061],
        upperRear: [0.6281, 0.05491, -0.3009],
        tyreTop: [0.19779, 0.11579, -0.01037],
        tyreBottom: [0.13715, -0.10163, 0.0017],
        steerCar: [0.6554, 0.08421, 0.1061],
        steerTyre: [0.15779, 0.11579, 0.1061],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.4929, -0.06068, 0.43205],
        lowerRear: [0.7099, -0.08915, 0.16851],
        upperFront: [0.5838, 0.09418, 0.31423],
        upperRear: [0.7295, 0.09084, 0.001],
        tyreTop: [0.24923, 0.1254, 0.03021],
        tyreBottom: [0.21455, -0.07523, 0.09455],
        steerCar: [0.73059, -0.00962, -0.06816],
        steerTyre: [0.20189, 0.01109, -0.10109],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/ks_ferrari_f2004",
      sourceFile: "data.acd"
    },
    mercedes_amg_gt3: {
      id: "mercedes_amg_gt3",
      carId: "ks_mercedes_amg_gt3",
      name: "Mercedes-AMG GT3",
      shortName: "AMG GT3",
      tag: "GT3",
      massKg: 1360,
      wheelbaseM: 2.65,
      frontWeight: 0.48,
      trackFrontM: 1.75,
      trackRearM: 1.72,
      cgHeightM: 0.4041,
      baseYFrontM: -0.055,
      baseYRearM: -0.06,
      springFrontNm: 80000,
      springRearNm: 120000,
      arbFrontNm: 50000,
      arbRearNm: 18650,
      tyreCompounds: MERCEDES_AMG_GT3_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.71,
      cockpitBrakeAdjustable: true,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.71 \u00b7 COCKPIT_ADJUSTABLE = 1",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.4655, -0.2202, 0.2058],
        lowerRear: [0.4627, -0.1912, -0.2565],
        upperFront: [0.328, 0.0885, 0.1111],
        upperRear: [0.325, 0.0644, -0.1517],
        tyreTop: [0.131, 0.1178, -0.0274],
        tyreBottom: [0.0967, -0.1738, 0.0344],
        steerCar: [0.4503, -0.1092, 0.1593],
        steerTyre: [0.0941, -0.071, 0.19],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.4826, -0.1898, 0.2236],
        lowerRear: [0.4826, -0.2148, -0.144],
        upperFront: [0.3793, 0.0844, 0.1416],
        upperRear: [0.3701, 0.0959, -0.1316],
        tyreTop: [0.1252, 0.1398, -0.0451],
        tyreBottom: [0.1171, -0.1766, -0.0038],
        steerCar: [0.4749, -0.0956, -0.1153],
        steerTyre: [0.119, -0.043, -0.1222],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/ks_mercedes_amg_gt3",
      sourceFile: "data.acd"
    },
    lotus_exige_v6_cup: {
      id: "lotus_exige_v6_cup",
      carId: "lotus_exige_v6_cup",
      name: "Lotus Exige V6 Cup",
      shortName: "Exige V6 Cup",
      tag: "V6C",
      massKg: 1155,
      wheelbaseM: 2.37,
      frontWeight: 0.41,
      trackFrontM: 1.457,
      trackRearM: 1.503,
      cgHeightM: 0.41567,
      baseYFrontM: -0.1,
      baseYRearM: -0.1,
      springFrontNm: 42736,
      springRearNm: 72617,
      arbFrontNm: 31000,
      arbRearNm: 4521,
      tyreCompounds: LOTUS_EXIGE_V6_CUP_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.635,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.635 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.4536, -0.1225, 0.1702],
        lowerRear: [0.4536, -0.1225, -0.1628],
        upperFront: [0.3546, 0.0935, 0.169],
        upperRear: [0.3546, 0.0935, -0.031],
        tyreTop: [0.10524, 0.1305, -0.00292],
        tyreBottom: [0.05173, -0.10538, 0.011],
        steerCar: [0.39276, -0.08859, -0.17501],
        steerTyre: [0.09213, -0.06733, -0.13076],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.4815, -0.14, 0.3],
        lowerRear: [0.4815, -0.14, -0.05],
        upperFront: [0.2515, 0.112, 0.3],
        upperRear: [0.2515, 0.112, -0.05],
        tyreTop: [0.0915, 0.14, 0],
        tyreBottom: [0.0915, -0.14, 0],
        steerCar: [0.4015, -0.02, -0.17],
        steerTyre: [0.0915, 0, -0.17],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/lotus_exige_v6_cup",
      sourceFile: "data.acd"
    },
    lotus_exige_240: {
      id: "lotus_exige_240",
      carId: "lotus_exige_240",
      name: "Lotus Exige 240R",
      shortName: "Exige 240R",
      tag: "240R",
      massKg: 1005,
      wheelbaseM: 2.3,
      frontWeight: 0.41,
      trackFrontM: 1.457,
      trackRearM: 1.503,
      cgHeightM: 0.387206,
      baseYFrontM: -0.065,
      baseYRearM: -0.085,
      springFrontNm: 33350,
      springRearNm: 57780,
      arbFrontNm: 28000,
      arbRearNm: 0,
      tyreCompounds: LOTUS_EXIGE_240_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.72,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.72 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.47337, -0.12175, 0.16949],
        lowerRear: [0.47337, -0.12175, -0.16189],
        upperFront: [0.37503, 0.09338, 0.16949],
        upperRear: [0.37503, 0.09341, -0.03137],
        tyreTop: [0.12129, 0.1279, -0.00291],
        tyreBottom: [0.07132, -0.10988, 0.01131],
        steerCar: [0.30503, 0.09338, -0.1],
        steerTyre: [0.15028, 0.10944, -0.11802],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.41891, -0.09113, 0.46344],
        lowerRear: [0.41891, -0.11976, -0.10175],
        upperFront: [0.32221, 0.10247, 0.02655],
        upperRear: [0.32221, 0.09666, -0.20708],
        tyreTop: [0.13378, 0.13098, -0.01905],
        tyreBottom: [0.09939, -0.10921, 0.01624],
        steerCar: [0.39276, -0.07859, -0.17501],
        steerTyre: [0.12213, -0.06733, -0.13076],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/lotus_exige_240",
      sourceFile: "data.acd"
    },
    corvette_c6_z06: {
      id: "corvette_c6_z06",
      carId: "corvette_c6_z06",
      name: "Chevrolet Corvette C6 Z06",
      shortName: "C6 Z06",
      tag: "Z06",
      massKg: 1495,
      wheelbaseM: 2.685,
      frontWeight: 0.512,
      trackFrontM: 1.613,
      trackRearM: 1.588,
      cgHeightM: 0.476754,
      baseYFrontM: -0.145,
      baseYRearM: -0.145,
      springFrontNm: 55755,
      springRearNm: 61582,
      arbFrontNm: 20000,
      arbRearNm: 7800,
      tyreCompounds: CORVETTE_C6_Z06_TYRE_COMPOUNDS,
      defaultCompoundId: "ac1",
      brakeBiasFront: 0.645,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.645 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.55398, -0.10884, 0.14284],
        lowerRear: [0.55832, -0.10231, -0.20303],
        upperFront: [0.42186, 0.17789, 0.10377],
        upperRear: [0.42185, 0.15692, -0.13185],
        tyreTop: [0.1412, 0.15555, -0.0342],
        tyreBottom: [0.09371, -0.14304, 0.00616],
        steerCar: [0.55832, -0.019, 0.04438],
        steerTyre: [0.13964, -0.04136, 0.20309],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.55223, -0.13255, 0.15944],
        lowerRear: [0.55223, -0.15479, -0.14822],
        upperFront: [0.42154, 0.18591, -0.2271],
        upperRear: [0.41837, 0.1803, 0.01262],
        tyreTop: [0.1526, 0.17918, 0.00181],
        tyreBottom: [0.07551, -0.17854, -0.00406],
        steerCar: [0.50536, -0.02815, -0.17373],
        steerTyre: [0.10937, -0.05097, -0.16622],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/corvette_c6_z06",
      sourceFile: "data.acd"
    },
    mazda_rx7_spirit_r: {
      id: "mazda_rx7_spirit_r",
      carId: "ks_mazda_rx7_spirit_r",
      name: "Mazda RX-7 Spirit R",
      shortName: "RX-7 Spirit R",
      tag: "FD3S",
      massKg: 1345,
      wheelbaseM: 2.425,
      frontWeight: 0.5,
      trackFrontM: 1.46,
      trackRearM: 1.46,
      cgHeightM: 0.48245,
      baseYFrontM: -0.16,
      baseYRearM: -0.175,
      springFrontNm: 40000,
      springRearNm: 40000,
      arbFrontNm: 21500,
      arbRearNm: 9000,
      tyreCompounds: MAZDA_RX7_SPIRIT_R_TYRE_COMPOUNDS,
      defaultCompoundId: "ac2",
      brakeBiasFront: 0.675,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.675 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.4248, -0.0749, 0.01],
        lowerRear: [0.3961, -0.07955, -0.37023],
        upperFront: [0.32296, 0.12061, 0.1075],
        upperRear: [0.32296, 0.12049, -0.1335],
        tyreTop: [0.09532, 0.11191, -0.013],
        tyreBottom: [0.0738, -0.0977, 0.0102],
        steerCar: [0.4248, -0.0749, 0.07591],
        steerTyre: [0.0738, -0.0977, 0.12715],
        strutCar: null,
        strutTyre: null
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.13541, -0.05032, 0.45223],
        lowerRear: [0.44042, -0.03796, -0.10722],
        upperFront: [0.28184, 0.12692, 0.14025],
        upperRear: [0.28184, 0.12477, -0.14025],
        tyreTop: [0.1202, 0.1, 0],
        tyreBottom: [0.0902, -0.1, -0.11],
        steerCar: [0.2932, -0.00561, 0.2197],
        steerTyre: [0.0602, -0.055511, 0.15117],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/ks_mazda_rx7_spirit_r",
      sourceFile: "data.acd"
    },
    honda_civic_type_r_2008: {
      id: "honda_civic_type_r_2008",
      carId: "ddm_honda_civic_type_r_2008",
      name: "Honda Civic Type R 2008",
      shortName: "Civic Type R",
      tag: "FD2",
      massKg: 1345,
      wheelbaseM: 2.7,
      frontWeight: 0.604,
      trackFrontM: 1.505,
      trackRearM: 1.515,
      cgHeightM: 0.528,
      baseYFrontM: -0.21,
      baseYRearM: -0.21,
      springFrontNm: 47000,
      springRearNm: 40000,
      arbFrontNm: 17500,
      arbRearNm: 17000,
      tyreCompounds: HONDA_CIVIC_TYPE_R_2008_TYRE_COMPOUNDS,
      defaultCompoundId: "ac0",
      brakeBiasFront: 0.7,
      cockpitBrakeAdjustable: false,
      driveType: "FWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.7 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=FWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.40769, -0.10955, 0.01423],
        lowerRear: [0.40944, -0.12017, -0.27373],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.07174, -0.1371, 0.01213],
        steerCar: [0.50186, -0.03346, -0.19172],
        steerTyre: [0.10565, -0.05257, -0.12586],
        strutCar: [0.2, 0.54933, -0.07105],
        strutTyre: [0.07174, -0.1371, 0.01213]
      },
      rearSuspension: {
        type: "DWB",
        name: "\u53cc\u53c9\u81c2",
        visualType: "dwb",
        springMode: "derived",
        lowerFront: [0.141, -0.0701, 0.38113],
        lowerRear: [0.44042, -0.08989, -0.03035],
        upperFront: [0.39022, 0.08701, 0.04129],
        upperRear: [0.42022, 0.09469, -0.04111],
        tyreTop: [0.11, 0.1122, 0],
        tyreBottom: [0.0913, -0.10511, 0.01],
        steerCar: [0.3899, -0.0454, 0.1602],
        steerTyre: [0.0913, -0.05342, 0.14988],
        strutCar: null,
        strutTyre: null
      },
      sourcePath: "assettocorsa/content/cars/ddm_honda_civic_type_r_2008",
      sourceFile: "data.acd"
    },
    toyota_mrs_haru: {
      id: "toyota_mrs_haru",
      carId: "ddm_toyota_mrs_haru",
      name: "Toyota MR-S Haru-Spec",
      shortName: "MR-S Haru",
      tag: "MR-S",
      massKg: 955.1,
      wheelbaseM: 2.45,
      frontWeight: 0.4246,
      trackFrontM: 1.475,
      trackRearM: 1.46,
      cgHeightM: 0.450139,
      baseYFrontM: -0.135,
      baseYRearM: -0.155,
      springFrontNm: 45601,
      springRearNm: 64528,
      arbFrontNm: 14760,
      arbRearNm: 10421,
      tyreCompounds: TOYOTA_MRS_HARU_TYRE_COMPOUNDS,
      defaultCompoundId: "ac0",
      brakeBiasFront: 0.5,
      cockpitBrakeAdjustable: false,
      driveType: "RWD",
      brakeSource: "brakes.ini [DATA] FRONT_SHARE = 0.5 \u00b7 COCKPIT_ADJUSTABLE = 0",
      driveSource: "drivetrain.ini [TRACTION] TYPE=RWD",
      frontSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.4036, -0.114, 0.0031],
        lowerRear: [0.3871, -0.113, -0.2359],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.0763, -0.1092, 0.0057],
        steerCar: [0.4223, -0.0773, 0.0877],
        steerTyre: [0.0645, -0.0699, 0.0888],
        strutCar: [0.2303, 0.447, -0.0265],
        strutTyre: [0.1439, 0.0268, -0.0081]
      },
      rearSuspension: {
        type: "STRUT",
        name: "\u9ea6\u5f17\u900a\u652f\u67f1",
        visualType: "strut",
        springMode: "strut",
        lowerFront: [0.2945, -0.024, 0.3277],
        lowerRear: [0.4625, -0.096, -0.0913],
        upperFront: null,
        upperRear: null,
        tyreTop: null,
        tyreBottom: [0.1301, -0.09, -0.0504],
        steerCar: [0.5385, -0.0834, -0.2303],
        steerTyre: [0.1843, -0.07, -0.1631],
        strutCar: [0.3245, 0.536, -0.0781],
        strutTyre: [0.232, 0.239, -0.0679]
      },
      sourcePath: "assettocorsa/content/cars/ddm_toyota_mrs_haru",
      sourceFile: "data.acd"
    },
  };

  var CAR_ORDER = ['gt86', 'mx5_nd', 'mx5_cup', 'subaru_22b', 's2000_ap1', 'porsche_911_gt3_cup_2017', 'porsche_cayman_gt4_clubsport', 'bmw_m3_e92', 'bmw_m4', 'bmw_z4', 'bmw_z4_gt3', 'ferrari_f2004', 'mercedes_amg_gt3', 'lotus_exige_v6_cup', 'lotus_exige_240', 'corvette_c6_z06', 'mazda_rx7_spirit_r', 'honda_civic_type_r_2008', 'toyota_mrs_haru'];
  var DEFAULT_CAR_ID = 'gt86';

  function getCarProfile(carId) {
    return CAR_PROFILES[carId] || CAR_PROFILES[DEFAULT_CAR_ID];
  }

  function createBaseState(carId, compoundId) {
    var profile = getCarProfile(carId);
    var compound = profile.tyreCompounds[compoundId] ||
      profile.tyreCompounds[profile.defaultCompoundId];
    var front = compound.front || compound;
    var rear = compound.rear || compound;
    return {
      carId: profile.id,
      massKg: profile.massKg,
      wheelbaseM: profile.wheelbaseM,
      frontWeight: profile.frontWeight,
      cgHeightM: profile.cgHeightM,
      trackFrontM: profile.trackFrontM,
      trackRearM: profile.trackRearM,
      springFrontNmm: profile.springFrontNm / 1000,
      springRearNmm: profile.springRearNm / 1000,
      arbFrontNmm: profile.arbFrontNm / 1000,
      arbRearNmm: profile.arbRearNm / 1000,
      tireMuRef: front.muRef,
      tireFz0N: front.fz0N,
      tireLoadSensitivityK: front.k,
      tireVerticalRateNm: front.verticalRateNm,
      tireWidthM: front.widthM,
      tireRadiusM: front.radiusM,
      tireRearMuRef: rear.muRef,
      tireRearFz0N: rear.fz0N,
      tireRearLoadSensitivityK: rear.k,
      tireRearVerticalRateNm: rear.verticalRateNm,
      tireRearWidthM: rear.widthM,
      tireRearRadiusM: rear.radiusM,
      brakeBiasFront: profile.brakeBiasFront,
      driveType: profile.driveType,
      lateralG: 0.85,
      longitudinalG: 0
    };
  }

  var BASE_STATE = Object.freeze(createBaseState(DEFAULT_CAR_ID));

  var LIMITS = Object.freeze({
    massKg: [450, 2000],
    wheelbaseM: [2.0, 3.4],
    frontWeight: [0.30, 0.70],
    cgHeightM: [0.20, 0.70],
    trackFrontM: [1.20, 1.85],
    trackRearM: [1.20, 1.85],
    springFrontNmm: [8, 200],
    springRearNmm: [8, 200],
    arbFrontNmm: [0, 80],
    arbRearNmm: [0, 60],
    tireMuRef: [0.60, 2.00],
    tireFz0N: [1000, 4500],
    tireLoadSensitivityK: [0, 0.90],
    tireVerticalRateNm: [100000, 400000],
    tireWidthM: [0.10, 0.50],
    tireRadiusM: [0.20, 0.50],
    tireRearMuRef: [0.60, 2.00],
    tireRearFz0N: [1000, 4500],
    tireRearLoadSensitivityK: [0, 0.90],
    tireRearVerticalRateNm: [100000, 400000],
    tireRearWidthM: [0.10, 0.50],
    tireRearRadiusM: [0.20, 0.50],
    brakeBiasFront: [0.30, 0.90],
    lateralG: [-2.00, 2.00],
    longitudinalG: [-2.00, 2.00]
  });

  var NEUTRAL_BAND_PP = 0.35;
  var REFERENCE_SPEED_KMH = 100;

  // A sustained longitudinal demand is required before an axle-limit condition
  // is labelled as a power / braking state rather than a generic axle limit.
  var VEHICLE_STATE_LONG_THRESHOLD_G = 0.10;
  var VEHICLE_STATES = Object.freeze({
    powerOver: Object.freeze({
      code: 'power-over',
      label: '动力甩尾',
      labelEn: 'POWER OVERSTEER',
      direction: 'accel',
      axle: 'rear'
    }),
    powerUnder: Object.freeze({
      code: 'power-under',
      label: '动力推头',
      labelEn: 'POWER UNDER',
      direction: 'accel',
      axle: 'front'
    }),
    midCornerUndersteer: Object.freeze({
      code: 'mid-corner-understeer',
      label: '弯中推头',
      labelEn: 'MID-CORNER UNDERSTEER',
      direction: 'mid',
      axle: 'front'
    }),
    midCornerOversteer: Object.freeze({
      code: 'mid-corner-oversteer',
      label: '弯中甩尾',
      labelEn: 'MID-CORNER OVERSTEER',
      direction: 'mid',
      axle: 'rear'
    }),
    frontLock: Object.freeze({
      code: 'front-lock',
      label: '前轮抱死',
      labelEn: 'FRONT LOCK',
      direction: 'brake',
      axle: 'front'
    }),
    rearLock: Object.freeze({
      code: 'rear-lock',
      label: '后轮抱死',
      labelEn: 'REAR LOCK',
      direction: 'brake',
      axle: 'rear'
    }),
    lossOfControl: Object.freeze({
      code: 'loss-of-control',
      label: '失控',
      labelEn: 'LOSS OF CONTROL',
      direction: 'both',
      axle: 'both'
    })
  });

  function classifyVehicleState(frontUtil, rearUtil, longitudinalG) {
    var frontOver = frontUtil >= 1;
    var rearOver = rearUtil >= 1;
    if (!frontOver && !rearOver) {
      return null;
    }
    if (frontOver && rearOver) {
      return VEHICLE_STATES.lossOfControl;
    }
    if (longitudinalG > VEHICLE_STATE_LONG_THRESHOLD_G) {
      return rearOver ? VEHICLE_STATES.powerOver : VEHICLE_STATES.powerUnder;
    }
    if (longitudinalG < -VEHICLE_STATE_LONG_THRESHOLD_G) {
      return frontOver ? VEHICLE_STATES.frontLock : VEHICLE_STATES.rearLock;
    }
    return frontOver
      ? VEHICLE_STATES.midCornerUndersteer
      : VEHICLE_STATES.midCornerOversteer;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function seriesRate(a, b) {
    if (!(a > 0)) {
      return b > 0 ? b : 0;
    }
    if (!(b > 0)) {
      return a;
    }
    return (a * b) / (a + b);
  }

  function cloneBaseState(carId, compoundId) {
    return createBaseState(carId, compoundId);
  }

  function toFiniteNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normaliseState(input) {
    var provided = input || {};
    var s = Object.assign({}, BASE_STATE, provided);

    // Partial callers that provide one axle fall back to the other. Normal app
    // states always provide both axles explicitly.
    function fallback(frontKey, rearKey) {
      var hasFront = Object.prototype.hasOwnProperty.call(provided, frontKey);
      var hasRear = Object.prototype.hasOwnProperty.call(provided, rearKey);
      if (!hasFront && hasRear) {
        s[frontKey] = s[rearKey];
      } else if (hasFront && !hasRear) {
        s[rearKey] = s[frontKey];
      }
    }
    fallback('tireMuRef', 'tireRearMuRef');
    fallback('tireFz0N', 'tireRearFz0N');
    fallback('tireLoadSensitivityK', 'tireRearLoadSensitivityK');
    fallback('tireVerticalRateNm', 'tireRearVerticalRateNm');
    fallback('tireWidthM', 'tireRearWidthM');
    fallback('tireRadiusM', 'tireRearRadiusM');

    Object.keys(LIMITS).forEach(function (key) {
      var bounds = LIMITS[key];
      s[key] = clamp(toFiniteNumber(s[key], BASE_STATE[key]), bounds[0], bounds[1]);
    });
    var driveType = String(s.driveType || BASE_STATE.driveType).toUpperCase();
    s.driveType = Object.prototype.hasOwnProperty.call(DRIVE_MODES, driveType)
      ? driveType
      : BASE_STATE.driveType;
    return s;
  }

  function calculate(input) {
    var s = normaliseState(input);

    var mass = s.massKg;
    var ay = s.lateralG * G;
    var ax = s.longitudinalG * G;
    var totalLateralForce = mass * Math.abs(ay);
    var totalLongitudinalForce = mass * ax;
    var turnDirection = Math.abs(s.lateralG) < 0.02
      ? 'straight'
      : s.lateralG > 0 ? 'right' : 'left';
    var outerSide = turnDirection === 'straight'
      ? 'none'
      : s.lateralG > 0 ? 'left' : 'right';
    var isRightTurn = s.lateralG >= 0;

    var frontStaticAxle = mass * G * s.frontWeight;
    var rearStaticAxle = mass * G * (1 - s.frontWeight);
    var frontStaticWheel = frontStaticAxle / 2;
    var rearStaticWheel = rearStaticAxle / 2;

    // Positive ax (forward acceleration) shifts normal load rearward.
    var longitudinalTransfer = mass * ax * s.cgHeightM / s.wheelbaseM;
    var frontAxleLoadRaw = frontStaticAxle - longitudinalTransfer;
    var rearAxleLoadRaw = rearStaticAxle + longitudinalTransfer;
    // Keep total normal load equal to weight even when the linear longitudinal
    // transfer asks for more load than one axle can carry.
    var totalNormalLoad = mass * G;
    var frontAxleLoad = clamp(frontAxleLoadRaw, 0, totalNormalLoad);
    var rearAxleLoad = totalNormalLoad - frontAxleLoad;

    var frontSuspensionRateNmm = s.springFrontNmm + s.arbFrontNmm;
    var rearSuspensionRateNmm = s.springRearNmm + s.arbRearNmm;
    var frontTyreRateNm = s.tireVerticalRateNm > 0
      ? s.tireVerticalRateNm
      : DATA.tyreVerticalRateNm;
    var rearTyreRateNm = s.tireRearVerticalRateNm > 0
      ? s.tireRearVerticalRateNm
      : frontTyreRateNm;

    // The tyre vertical spring is in series with the suspension wheel rate at
    // each wheel. ARB is already represented as an equivalent wheel rate.
    var frontGroundRateNm = seriesRate(
      frontSuspensionRateNmm * 1000, frontTyreRateNm
    );
    var rearGroundRateNm = seriesRate(
      rearSuspensionRateNmm * 1000, rearTyreRateNm
    );

    // A pair of equal ground-level wheel rates contributes
    // (k * track^2 / 2) Nm per radian.
    var frontRollStiffness = frontGroundRateNm * s.trackFrontM * s.trackFrontM / 2;
    var rearRollStiffness = rearGroundRateNm * s.trackRearM * s.trackRearM / 2;
    var totalRollStiffness = frontRollStiffness + rearRollStiffness;
    var frontRollShare = totalRollStiffness > 0 ? frontRollStiffness / totalRollStiffness : 0.5;

    var rollMoment = totalLateralForce * s.cgHeightM;
    var rollAngleRad = totalRollStiffness > 0 ? rollMoment / totalRollStiffness : 0;
    var rollAngleDeg = rollAngleRad * 180 / Math.PI;

    // Load-transfer magnitudes are independent of turn direction. "Outer"
    // means the outside wheel of the current turn. The axle's roll moment is
    // balanced by an equal-and-opposite wheel-load pair, so each wheel changes
    // by share * rollMoment / track (not half of that).
    var frontLoadTransfer = frontRollShare * rollMoment / s.trackFrontM;
    var rearLoadTransfer = (1 - frontRollShare) * rollMoment / s.trackRearM;

    var frontOuterLoadRaw = frontAxleLoad / 2 + frontLoadTransfer;
    var frontInnerLoadRaw = frontAxleLoad / 2 - frontLoadTransfer;
    var rearOuterLoadRaw = rearAxleLoad / 2 + rearLoadTransfer;
    var rearInnerLoadRaw = rearAxleLoad / 2 - rearLoadTransfer;

    // Clamp both sides while preserving each axle's total normal load. Above
    // the lift threshold the linear model is outside its valid range; the
    // warning tells the user so, and the other axle is not rebalanced here.
    var frontInnerLoad = Math.max(0, frontInnerLoadRaw);
    var rearInnerLoad = Math.max(0, rearInnerLoadRaw);
    var frontOuterLoad = Math.min(frontAxleLoad, Math.max(0, frontOuterLoadRaw));
    var rearOuterLoad = Math.min(rearAxleLoad, Math.max(0, rearOuterLoadRaw));

    // AC load-sensitive tyre curve, evaluated per tyre at its actual Fz.
    // k = 1 - LS_EXPY; mu(Fz) = mu_ref * (Fz / FZ0)^(-k).
    // Fy_max = mu(Fz) * Fz.
    function tyreAtLoad(load, axle) {
      if (!(load > 0)) {
        return { load: 0, mu: 0, capacity: 0 };
      }
      var muRef = axle === 'rear' ? s.tireRearMuRef : s.tireMuRef;
      var fz0N = axle === 'rear' ? s.tireRearFz0N : s.tireFz0N;
      var k = axle === 'rear'
        ? s.tireRearLoadSensitivityK
        : s.tireLoadSensitivityK;
      var mu = muRef * Math.pow(load / fz0N, -k);
      return { load, mu, capacity: mu * load };
    }

    var tyreGrip = {
      frontOuter: tyreAtLoad(frontOuterLoad, 'front'),
      frontInner: tyreAtLoad(frontInnerLoad, 'front'),
      rearOuter: tyreAtLoad(rearOuterLoad, 'rear'),
      rearInner: tyreAtLoad(rearInnerLoad, 'rear')
    };

    var wheelGrip = {
      FL: isRightTurn ? tyreGrip.frontOuter : tyreGrip.frontInner,
      FR: isRightTurn ? tyreGrip.frontInner : tyreGrip.frontOuter,
      RL: isRightTurn ? tyreGrip.rearOuter : tyreGrip.rearInner,
      RR: isRightTurn ? tyreGrip.rearInner : tyreGrip.rearOuter
    };
    var actualWheelLoads = {
      FL: isRightTurn ? frontOuterLoad : frontInnerLoad,
      FR: isRightTurn ? frontInnerLoad : frontOuterLoad,
      RL: isRightTurn ? rearOuterLoad : rearInnerLoad,
      RR: isRightTurn ? rearInnerLoad : rearOuterLoad
    };

    var frontGrip = tyreGrip.frontOuter.capacity + tyreGrip.frontInner.capacity;
    var rearGrip = tyreGrip.rearOuter.capacity + tyreGrip.rearInner.capacity;

    var frontLateralDemand = totalLateralForce * s.frontWeight;
    var rearLateralDemand = totalLateralForce * (1 - s.frontWeight);

    // Longitudinal force allocation follows the selected drivetrain layout
    // under drive and the selected front share under braking.
    var driveMode = DRIVE_MODES[s.driveType] || DRIVE_MODES.RWD;
    var frontLongitudinalDemand;
    var rearLongitudinalDemand;
    if (totalLongitudinalForce >= 0) {
      frontLongitudinalDemand = totalLongitudinalForce * driveMode.front;
      rearLongitudinalDemand = totalLongitudinalForce * driveMode.rear;
    } else {
      frontLongitudinalDemand = totalLongitudinalForce * s.brakeBiasFront;
      rearLongitudinalDemand = totalLongitudinalForce * (1 - s.brakeBiasFront);
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

    var vehicleState = classifyVehicleState(frontUtil, rearUtil, s.longitudinalG);

    var frontWheelLift = frontInnerLoadRaw <= 1e-6;
    var rearWheelLift = rearInnerLoadRaw <= 1e-6;

    var referenceSpeedMs = REFERENCE_SPEED_KMH / 3.6;
    var cornerRadiusM = Math.abs(ay) > 0
      ? (referenceSpeedMs * referenceSpeedMs) / Math.abs(ay)
      : Infinity;

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
    if (s.tireLoadSensitivityK < 0.02 && s.tireRearLoadSensitivityK < 0.02) {
      warnings.push({
        code: 'low-load-sensitivity',
        severity: 'info',
        title: '轮胎载荷敏感度接近零',
        detail: '当前前后轴 k≈0，μ(Fz) 近似为常数；弹簧/ARB 造成的轴荷分配几乎不会改变轴总抓地力。'
      });
    }

    var staticWheelLoadFront = frontStaticWheel;
    var staticWheelLoadRear = rearStaticWheel;
    var tyreDeflectionFrontOuter = frontOuterLoad / frontTyreRateNm;
    var tyreDeflectionFrontInner = frontInnerLoad / frontTyreRateNm;
    var tyreDeflectionRearOuter = rearOuterLoad / rearTyreRateNm;
    var tyreDeflectionRearInner = rearInnerLoad / rearTyreRateNm;

    return {
      state: s,
      ay,
      ax,
      totalLateralForce,
      totalLongitudinalForce,
      mass,
      turnDirection,
      outerSide,
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
        driveType: s.driveType,
        driveBiasFront: driveMode.front,
        driveBiasRear: driveMode.rear,
        brakeBiasFront: s.brakeBiasFront,
        brakeBiasRear: 1 - s.brakeBiasFront
      },
      springRates: {
        frontNmm: frontSuspensionRateNmm,
        rearNmm: rearSuspensionRateNmm,
        springFrontNmm: s.springFrontNmm,
        springRearNmm: s.springRearNmm,
        arbFrontNmm: s.arbFrontNmm,
        arbRearNmm: s.arbRearNmm,
        tireFrontNmm: frontTyreRateNm / 1000,
        tireRearNmm: rearTyreRateNm / 1000,
        groundFrontNmm: frontGroundRateNm / 1000,
        groundRearNmm: rearGroundRateNm / 1000
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
      wheelGrip,
      wheelLoads: {
        FL: actualWheelLoads.FL,
        FR: actualWheelLoads.FR,
        RL: actualWheelLoads.RL,
        RR: actualWheelLoads.RR,
        frontOuter: frontOuterLoad,
        frontInner: frontInnerLoad,
        rearOuter: rearOuterLoad,
        rearInner: rearInnerLoad,
        frontOuterRaw: frontOuterLoadRaw,
        frontInnerRaw: frontInnerLoadRaw,
        rearOuterRaw: rearOuterLoadRaw,
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
      vehicleState: vehicleState,
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
    CARS: CAR_PROFILES,
    CAR_ORDER: CAR_ORDER,
    DEFAULT_CAR_ID: DEFAULT_CAR_ID,
    BASE_STATE: BASE_STATE,
    LIMITS: LIMITS,
    DRIVE_MODES: DRIVE_MODES,
    NEUTRAL_BAND_PP: NEUTRAL_BAND_PP,
    VEHICLE_STATES: VEHICLE_STATES,
    VEHICLE_STATE_LONG_THRESHOLD_G: VEHICLE_STATE_LONG_THRESHOLD_G,
    classifyVehicleState: classifyVehicleState,
    getCarProfile: getCarProfile,
    createBaseState: createBaseState,
    cloneBaseState: cloneBaseState,
    normaliseState: normaliseState,
    calculate: calculate,
    solveNeutralFrontArb: solveNeutralFrontArb,
    clamp: clamp
  };
});
