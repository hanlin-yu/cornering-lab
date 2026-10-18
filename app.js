(function () {
  'use strict';

  var model = window.CorneringModel;
  if (!model) {
    return;
  }

  var currentCarId = model.DEFAULT_CAR_ID;
  var currentCar = model.getCarProfile(currentCarId);
  var TYRE_COMPOUNDS = currentCar.tyreCompounds;
  var currentTyreId = currentCar.defaultCompoundId;
  var state = model.createBaseState(currentCarId);
  var PRESETS = {};
  var lastSourceSignature = '';
  var scene = null;
  var autoNoteTimer = null;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var G_PAD = Object.freeze({
    width: 320,
    height: 320,
    left: 36,
    right: 14,
    top: 16,
    bottom: 286,
    gMin: -2.0,
    gMax: 2.0
  });
  var gTrail = [];
  var gLastTrailPoint = null;
  var gPadDragging = false;
  var gPadPointerId = null;
  var gPlaying = false;
  var gPlayFrame = null;
  var gPlayStart = 0;
  var gPlayLastRender = 0;
  var G_PLAY_DURATION_MS = 6200;
  var G_REGION_STEP = 0.1;
  var G_REGION_INTERVAL_MS = 1000;
  var G_DELTA_SCALE_PP = 25;
  var G_STATE_ORDER = [
    'loss-of-control',
    'mid-corner-understeer',
    'mid-corner-oversteer',
    'power-over',
    'power-under',
    'front-lock',
    'rear-lock'
  ];
  var G_STATE_INDEX = {};
  G_STATE_ORDER.forEach(function (code, index) {
    G_STATE_INDEX[code] = index + 1;
  });
  var G_STATE_COLORS = {
    'mid-corner-understeer': [103, 224, 163],
    'mid-corner-oversteer': [255, 169, 77],
    'power-over': [255, 122, 47],
    'power-under': [53, 213, 223],
    'front-lock': [255, 209, 102],
    'rear-lock': [255, 79, 123],
    'loss-of-control': [183, 140, 255]
  };
  var G_STATE_DESCRIPTIONS = {
    'mid-corner-understeer': '纵向 G 接近 0；侧向主导时前轴先达到 100% 联合利用率',
    'mid-corner-oversteer': '纵向 G 接近 0；侧向主导时后轴先达到 100% 联合利用率',
    'power-over': '加速时后轴先达到 100% 联合利用率',
    'power-under': '加速时前轴先达到 100% 联合利用率',
    'front-lock': '减速时前轴先达到 100% 联合利用率',
    'rear-lock': '减速时后轴先达到 100% 联合利用率',
    'loss-of-control': '前后轴同时达到 100% 联合利用率'
  };
  var G_STATE_LABELS = {};
  if (model.VEHICLE_STATES) {
    Object.keys(model.VEHICLE_STATES).forEach(function (key) {
      var vehicleState = model.VEHICLE_STATES[key];
      G_STATE_LABELS[vehicleState.code] = vehicleState.label;
    });
  }
  var gHeatColorLut = null;
  var gRegionSampleCanvas = null;
  var gRegionSampleContext = null;
  var gRegionSampleImage = null;
  var gRegionsDirty = true;
  var gRegionTimer = null;

  function buildPresets(profile) {
    var stock = {
      springFrontNmm: profile.springFrontNm / 1000,
      springRearNmm: profile.springRearNm / 1000,
      arbFrontNmm: profile.arbFrontNm / 1000,
      arbRearNmm: profile.arbRearNm / 1000
    };
    return {
      stock: stock,
      front: {
        springFrontNmm: clamp(stock.springFrontNmm + 7, 8, 200),
        springRearNmm: stock.springRearNmm,
        arbFrontNmm: clamp(stock.arbFrontNmm + 21, 0, 80),
        arbRearNmm: stock.arbRearNmm
      },
      rear: {
        springFrontNmm: stock.springFrontNmm,
        springRearNmm: clamp(stock.springRearNmm + 6, 8, 200),
        arbFrontNmm: stock.arbFrontNmm,
        arbRearNmm: clamp(stock.arbRearNmm + 35, 0, 60)
      }
    };
  }

  PRESETS = buildPresets(currentCar);

  var TYRE_POINT_DEFS = [
    { code: 'FL', axle: 'front', side: 'inner', front: true, gripKey: 'frontInner' },
    { code: 'FR', axle: 'front', side: 'outer', front: true, gripKey: 'frontOuter' },
    { code: 'RL', axle: 'rear', side: 'inner', front: false, gripKey: 'rearInner' },
    { code: 'RR', axle: 'rear', side: 'outer', front: false, gripKey: 'rearOuter' }
  ];

  var TYRE_LABEL_CANDIDATES = [
    { dx: 8, dy: -6, anchor: 'start' },
    { dx: -8, dy: -6, anchor: 'end' },
    { dx: 8, dy: 16, anchor: 'start' },
    { dx: -8, dy: 16, anchor: 'end' },
    { dx: 0, dy: -12, anchor: 'middle' },
    { dx: 0, dy: 21, anchor: 'middle' },
    { dx: 12, dy: 4, anchor: 'start' },
    { dx: -12, dy: 4, anchor: 'end' }
  ];

  // Place the four wheel codes without overlap; the charts are narrow when
  // the two tyre plots share a row, so fixed offsets are not enough.
  function layoutTyrePointLabels(points, width, height, margin) {
    var labelWidth = 19;
    var labelHeight = 15;

    function boxFor(point, candidate) {
      var x = point.x + candidate.dx;
      var y = point.y + candidate.dy;
      var left = candidate.anchor === 'start'
        ? x
        : candidate.anchor === 'end' ? x - labelWidth : x - labelWidth / 2;
      return {
        left: left,
        right: left + labelWidth,
        top: y - (labelHeight - 3),
        bottom: y + 3
      };
    }

    function boxesOverlap(a, b, pad) {
      return !(a.right + pad <= b.left ||
        b.right + pad <= a.left ||
        a.bottom + pad <= b.top ||
        b.bottom + pad <= a.top);
    }

    var placed = [];
    return points.map(function (point, pointIndex) {
      var bestCandidate = TYRE_LABEL_CANDIDATES[0];
      var bestBox = boxFor(point, bestCandidate);
      var bestPenalty = Infinity;

      TYRE_LABEL_CANDIDATES.forEach(function (candidate) {
        var box = boxFor(point, candidate);
        var penalty = 0;
        if (box.left < margin.left || box.right > width - margin.right ||
          box.top < margin.top + 2 || box.bottom > height - margin.bottom - 2) {
          penalty += 12;
        }
        placed.forEach(function (otherBox) {
          if (boxesOverlap(box, otherBox, 2)) {
            penalty += 10;
          }
        });
        points.forEach(function (otherPoint, otherIndex) {
          if (otherIndex === pointIndex) {
            return;
          }
          var markerBox = {
            left: otherPoint.x - 7,
            right: otherPoint.x + 7,
            top: otherPoint.y - 7,
            bottom: otherPoint.y + 7
          };
          if (boxesOverlap(box, markerBox, 0)) {
            penalty += 6;
          }
        });

        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          bestCandidate = candidate;
          bestBox = box;
        }
      });

      placed.push(bestBox);
      return {
        x: point.x + bestCandidate.dx,
        y: point.y + bestCandidate.dy,
        anchor: bestCandidate.anchor
      };
    });
  }

  var COPY = {
    understeer: {
      cn: '推头',
      en: 'UNDERSTEER',
      kicker: 'FRONT AXLE SATURATES FIRST',
      sub: '前轴联合利用率更高，前轮先失去侧向余量。',
      hint: '往中性：软化前轴弹簧 / ARB，或增加后轴侧倾刚度。'
    },
    oversteer: {
      cn: '甩尾',
      en: 'OVERSTEER',
      kicker: 'REAR AXLE SATURATES FIRST',
      sub: '后轴联合利用率更高，后轮先失去侧向余量。',
      hint: '往中性：软化后轴弹簧 / ARB，或增加前轴侧倾刚度。'
    },
    neutral: {
      cn: '中性',
      en: 'NEUTRAL',
      kicker: 'AXLES REACH THE LIMIT TOGETHER',
      sub: '前后轴联合利用率几乎相同，接近同时达到极限。',
      hint: '前后轴联合利用率差位于 ±0.35 pp 中性带内。'
    }
  };

  var parameterElements = Array.prototype.slice.call(document.querySelectorAll('[data-param]'));
  var rangeElements = parameterElements.filter(function (element) {
    return element.type === 'range';
  });

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return value.toFixed(digits);
  }

  function formatForce(kN) {
    return formatNumber(kN / 1000, 2);
  }

  function formatPercent(fraction) {
    if (!Number.isFinite(fraction)) {
      return '>999%';
    }
    return (fraction * 100).toFixed(1) + '%';
  }

  function formatSigned(value, digits) {
    var d = digits == null ? 1 : digits;
    if (!Number.isFinite(value)) {
      return '—';
    }
    if (Math.abs(value) < 0.5 * Math.pow(10, -d)) {
      return (0).toFixed(d);
    }
    return (value > 0 ? '+' : '−') + Math.abs(value).toFixed(d);
  }

  function formatInputValue(value) {
    var rounded = Math.round(value * 10000) / 10000;
    return String(rounded);
  }

  function setText(id, text) {
    var element = $(id);
    if (element) {
      element.textContent = text;
    }
  }

  function toggleClass(element, className, enabled) {
    if (element) {
      element.classList.toggle(className, enabled);
    }
  }

  function setBarWidth(element, fraction) {
    if (!element) {
      return;
    }
    var percent = Number.isFinite(fraction) ? clamp(fraction, 0, 1) * 100 : 100;
    element.style.width = percent.toFixed(2) + '%';
    toggleClass(element, 'is-over', Number.isFinite(fraction) && fraction >= 1);
  }

  function updateRangeFill(element) {
    if (!element || element.type !== 'range') {
      return;
    }
    var min = Number(element.min);
    var max = Number(element.max);
    var value = Number(element.value);
    var fraction = max > min ? (value - min) / (max - min) : 0;
    element.style.setProperty('--fill', (clamp(fraction, 0, 1) * 100).toFixed(2) + '%');
  }

  function createSvgElement(tag, attributes, text) {
    var element = document.createElementNS(SVG_NS, tag);
    if (attributes) {
      Object.keys(attributes).forEach(function (key) {
        element.setAttribute(key, attributes[key]);
      });
    }
    if (text != null) {
      element.textContent = text;
    }
    return element;
  }

  function clearSvgGroup(group) {
    if (!group) {
      return;
    }
    while (group.firstChild) {
      group.removeChild(group.firstChild);
    }
  }

  function niceStep(value) {
    if (!(value > 0) || !Number.isFinite(value)) {
      return 1;
    }
    var exponent = Math.floor(Math.log(value) / Math.LN10);
    var magnitude = Math.pow(10, exponent);
    var fraction = value / magnitude;
    var niceFraction;
    if (fraction <= 1) {
      niceFraction = 1;
    } else if (fraction <= 2) {
      niceFraction = 2;
    } else if (fraction <= 2.5) {
      niceFraction = 2.5;
    } else if (fraction <= 5) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
    return niceFraction * magnitude;
  }

  function currentTyreName() {
    if (currentTyreId === 'custom') {
      return '自定义';
    }
    var compound = TYRE_COMPOUNDS[currentTyreId];
    return compound ? compound.name : '—';
  }

  function formatTyrePair(front, rear, digits) {
    var frontText = Number(front).toFixed(digits);
    if (Math.abs(Number(front) - Number(rear)) < 1e-9) {
      return frontText;
    }
    return frontText + ' / ' + Number(rear).toFixed(digits);
  }

  function formatTyrePairInt(front, rear) {
    var frontText = String(Math.round(Number(front)));
    if (Math.abs(Number(front) - Number(rear)) < 1e-9) {
      return frontText;
    }
    return frontText + ' / ' + String(Math.round(Number(rear)));
  }

  function applyCompoundToState(compound) {
    var front = compound.front || compound;
    var rear = compound.rear || compound;
    state.tireMuRef = front.muRef;
    state.tireFz0N = front.fz0N;
    state.tireLoadSensitivityK = front.k;
    state.tireVerticalRateNm = front.verticalRateNm;
    state.tireWidthM = front.widthM;
    state.tireRadiusM = front.radiusM;
    state.tireRearMuRef = rear.muRef;
    state.tireRearFz0N = rear.fz0N;
    state.tireRearLoadSensitivityK = rear.k;
    state.tireRearVerticalRateNm = rear.verticalRateNm;
    state.tireRearWidthM = rear.widthM;
    state.tireRearRadiusM = rear.radiusM;
  }

  function sortedCompounds() {
    return Object.keys(TYRE_COMPOUNDS).map(function (id) {
      return TYRE_COMPOUNDS[id];
    }).sort(function (a, b) {
      return a.index - b.index;
    });
  }

  function populateTyreOptions() {
    var select = $('tyreCompoundSelect');
    if (!select) {
      return;
    }
    select.innerHTML = '';
    sortedCompounds().forEach(function (compound) {
      var option = document.createElement('option');
      option.value = compound.id;
      option.textContent = compound.name + ' · ' + compound.short;
      select.appendChild(option);
    });
    var custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = '自定义 · CUSTOM';
    select.appendChild(custom);
    select.value = currentTyreId;
  }

  function populateCarOptions() {
    var select = $('carSelect');
    if (!select) {
      return;
    }
    select.innerHTML = '';
    model.CAR_ORDER.forEach(function (carId) {
      var profile = model.getCarProfile(carId);
      var option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name + ' · ' + profile.driveType;
      select.appendChild(option);
    });
    select.value = currentCarId;
  }

  function updateVehicleBar() {
    setText('barMass', String(Math.round(state.massKg)));
    setText('barWheelbase', state.wheelbaseM.toFixed(3));
    setText('barDrive', state.driveType);
    var widthText = Math.round(state.tireWidthM * 1000) + 'mm';
    if (Math.abs(state.tireRearWidthM - state.tireWidthM) > 1e-9) {
      widthText = Math.round(state.tireWidthM * 1000) + '/' +
        Math.round(state.tireRearWidthM * 1000) + 'mm';
    }
    setText('barTire', currentTyreName() + ' · ' + widthText);
  }

  function updateSourcePanel() {
    var list = $('sourceDataList');
    if (!list) {
      return;
    }
    var signature = [
      currentCar.id,
      currentTyreId,
      state.driveType,
      state.brakeBiasFront,
      state.tireMuRef,
      state.tireFz0N,
      state.tireLoadSensitivityK,
      state.tireWidthM,
      state.tireRadiusM,
      state.tireVerticalRateNm,
      state.tireRearMuRef,
      state.tireRearFz0N,
      state.tireRearLoadSensitivityK,
      state.tireRearWidthM,
      state.tireRearRadiusM,
      state.tireRearVerticalRateNm
    ].join('|');
    if (signature === lastSourceSignature) {
      return;
    }
    lastSourceSignature = signature;

    var profile = currentCar;
    var selected = currentTyreId === 'custom' ? null : TYRE_COMPOUNDS[currentTyreId];
    var defaultTire = profile.tyreCompounds[profile.defaultCompoundId];
    var selectedName = selected ? selected.name : '自定义';
    var compoundNames = sortedCompounds().map(function (compound) {
      return compound.name;
    }).join(' / ');
    var widthMm = Math.round(state.tireWidthM * 1000) + ' / ' +
      Math.round(state.tireRearWidthM * 1000);
    var biasPct = Math.round(profile.brakeBiasFront * 100);
    var selectedSection = selected ? selected.section : 'CUSTOM';
    var selectedNote = selected
      ? selectedSection + ' · μ_ref F/R ' +
        formatTyrePair(state.tireMuRef, state.tireRearMuRef, 3) +
        ' · FZ0 F/R ' + formatTyrePairInt(state.tireFz0N, state.tireRearFz0N) +
        ' N · k F/R ' +
        formatTyrePair(state.tireLoadSensitivityK, state.tireRearLoadSensitivityK, 4)
      : 'CUSTOM · μ_ref/k 前后共用 ' + state.tireMuRef.toFixed(3) + ' / ' +
        state.tireLoadSensitivityK.toFixed(4) +
        ' · FZ0 F/R ' + formatTyrePairInt(state.tireFz0N, state.tireRearFz0N) + ' N';

    setText('sourceCarTag', profile.shortName + ' / ' + profile.tag);
    setText('sourceBadge', profile.carId + ' / ' + profile.sourceFile);
    setText('sourcePath',
      '…\\assettocorsa\\content\\cars\\' + profile.carId + '\\' + profile.sourceFile);
    setText('sourceSummaryHint',
      'AC解包 · ' + profile.shortName + ' · ' + selectedName +
      ' · ' + state.driveType + ' · 制动 ' + biasPct + '/' + (100 - biasPct));

    list.innerHTML = '';
    [
      ['质量', profile.massKg + ' kg', 'TOTALMASS · 含车手 / 无燃油'],
      ['轴距', profile.wheelbaseM.toFixed(3) + ' m', 'WHEELBASE'],
      ['前轴荷', (profile.frontWeight * 100).toFixed(1) + '%',
        'CG_LOCATION = ' + profile.frontWeight.toFixed(3)],
      ['轮距 F / R',
        profile.trackFrontM.toFixed(3) + ' / ' + profile.trackRearM.toFixed(3) + ' m',
        '[FRONT] / [REAR] TRACK'],
      ['质心高度', profile.cgHeightM.toFixed(3) + ' m',
        'RADIUS − BASEY（前后加权估算）'],
      ['弹簧率 F / R',
        (profile.springFrontNm / 1000).toFixed(1) + ' / ' +
        (profile.springRearNm / 1000).toFixed(1) + ' N/mm',
        'SPRING_RATE ' + profile.springFrontNm + ' / ' + profile.springRearNm + ' N/m'],
      ['ARB F / R',
        (profile.arbFrontNm / 1000).toFixed(1) + ' / ' +
        (profile.arbRearNm / 1000).toFixed(1) + ' N/mm',
        '[ARB] ' + profile.arbFrontNm + ' / ' + profile.arbRearNm + ' N/m · 轮端等效约定'],
      ['制动前轴占比', biasPct + ' / ' + (100 - biasPct) + '%',
        profile.brakeSource + ' · COCKPIT_ADJUSTABLE = ' +
        (profile.cockpitBrakeAdjustable ? '1' : '0')],
      ['驱动形式', profile.driveType, profile.driveSource],
      ['轮胎胶料', compoundNames, '默认 ' + defaultTire.name],
      ['当前胶料', selectedName, selectedNote],
      ['轮胎宽度 F / R', widthMm + ' mm',
        'WIDTH；不进入 μ(Fz) 幂律'],
      ['轮胎半径 F / R',
        state.tireRadiusM.toFixed(4) + ' / ' + state.tireRearRadiusM.toFixed(4) + ' m',
        'RADIUS，前后轴独立读取'],
      ['垂向刚度 F / R',
        Math.round(state.tireVerticalRateNm).toLocaleString('en-US') + ' / ' +
        Math.round(state.tireRearVerticalRateNm).toLocaleString('en-US') + ' N/m',
        '垂向刚度仅用于 3D 轮胎压缩视觉'],
      ['悬挂形式',
        '前 ' + profile.frontSuspension.type + ' · ' + profile.frontSuspension.name +
        ' / 后 ' + profile.rearSuspension.type + ' · ' + profile.rearSuspension.name,
        '3D 硬点来自 suspensions.ini；前弹簧 ' +
        (profile.frontSuspension.springMode === 'strut' ? '沿 STRUT 轴' : 'DWB 轴推导') +
        '，后弹簧 ' +
        (profile.rearSuspension.springMode === 'strut' ? '沿 STRUT 轴' : 'DWB 轴推导') +
        (profile.id === 'subaru_22b' ? '；22B 后悬 AC 原始 TYPE=STRUT' : '') +
        (profile.frontSuspension.springMode === 'derived' ||
          profile.rearSuspension.springMode === 'derived'
          ? '（AC 未给出减振器上安装点）'
          : '')]
    ].forEach(function (row) {
      var item = document.createElement('div');
      var term = document.createElement('dt');
      var description = document.createElement('dd');
      var note = document.createElement('small');
      term.textContent = row[0];
      description.textContent = row[1];
      note.textContent = row[2];
      description.appendChild(document.createTextNode(' '));
      description.appendChild(note);
      item.appendChild(term);
      item.appendChild(description);
      list.appendChild(item);
    });
  }

  function updateCarUi() {
    setText('carTag', currentCar.tag);
    setText('stockPresetLabel', currentCar.shortName + ' 原厂');
    setText('frontSuspensionLabel', currentCar.frontSuspension.name);
    setText('rearSuspensionLabel', currentCar.rearSuspension.name);

    var distributionNote = $('distributionSourceNote');
    if (distributionNote) {
      distributionNote.innerHTML =
        'AC 原车：brakes.ini <b>FRONT_SHARE = ' +
        currentCar.brakeBiasFront.toFixed(3) +
        '</b>，drivetrain.ini <b>TYPE = ' + currentCar.driveType +
        '</b>，COCKPIT_ADJUSTABLE = ' +
        (currentCar.cockpitBrakeAdjustable ? '1' : '0') +
        '；上方为分析用自定义。制动占比影响制动阶段，驱动形式影响加速阶段。';
    }

    var carSelect = $('carSelect');
    if (carSelect && carSelect.value !== currentCarId) {
      carSelect.value = currentCarId;
    }
    updateSourcePanel();
    updateVehicleBar();
  }

  function loadCar(carId) {
    var profile = model.getCarProfile(carId);
    var previousLateralG = state.lateralG;
    var previousLongitudinalG = state.longitudinalG;

    currentCarId = profile.id;
    currentCar = profile;
    TYRE_COMPOUNDS = profile.tyreCompounds;
    currentTyreId = profile.defaultCompoundId;
    PRESETS = buildPresets(profile);
    state = model.createBaseState(profile.id);
    state.lateralG = previousLateralG;
    state.longitudinalG = previousLongitudinalG;

    stopGPlayback(false);
    clearGTrail();
    clearAutoNote();
    lastSourceSignature = '';
    populateTyreOptions();
    updateCarUi();

    if (scene && typeof scene.setCar === 'function') {
      scene.setCar(profile);
    }

    markGRegionsDirty();
    syncControls();
    syncTyreUi();
    render();
  }

  function syncTyreUi() {
    var select = $('tyreCompoundSelect');
    if (select && select.value !== currentTyreId) {
      select.value = currentTyreId;
    }

    var customFields = $('tyreCustomFields');
    if (customFields) {
      customFields.hidden = currentTyreId !== 'custom';
    }

    var compound = TYRE_COMPOUNDS[currentTyreId];
    var tag = currentTyreId === 'custom'
      ? 'CUSTOM'
      : compound ? compound.name.toUpperCase() : 'TYRE';

    setText('compoundTag', tag);
    setText('tyreMuReadout',
      formatTyrePair(state.tireMuRef, state.tireRearMuRef, 3));
    setText('tyreKReadout',
      formatTyrePair(state.tireLoadSensitivityK, state.tireRearLoadSensitivityK, 3));
    setText('tyreFz0Readout',
      formatTyrePairInt(state.tireFz0N, state.tireRearFz0N));
    setText('curveTyreName', currentTyreName());
    updateVehicleBar();
  }

  function gPadX(lateralG) {
    var plotWidth = G_PAD.width - G_PAD.left - G_PAD.right;
    var fraction = (lateralG - G_PAD.gMin) / (G_PAD.gMax - G_PAD.gMin);
    return G_PAD.left + fraction * plotWidth;
  }

  function gPadY(longitudinalG) {
    // Vertical orientation: brake (-longitudinal) points up; acceleration
    // (+longitudinal) points down.
    var plotHeight = G_PAD.bottom - G_PAD.top;
    var fraction = (longitudinalG - G_PAD.gMin) / (G_PAD.gMax - G_PAD.gMin);
    return G_PAD.top + fraction * plotHeight;
  }

  function gPadPath(points) {
    if (!points.length) {
      return '';
    }
    return points.map(function (point, index) {
      return (index === 0 ? 'M' : 'L') +
        gPadX(point.lat).toFixed(2) + ' ' + gPadY(point.long).toFixed(2);
    }).join(' ');
  }

  function cornerPointAt(progress) {
    var s = clamp(progress, 0, 1);
    var lat = 0.20 + 0.75 * Math.sin(Math.PI * Math.pow(s, 0.9));
    var long = -0.85 * Math.pow(1 - s, 1.6) + 0.45 * Math.pow(s, 2.2);
    return {
      lat: clamp(lat, G_PAD.gMin, G_PAD.gMax),
      long: clamp(long, G_PAD.gMin, G_PAD.gMax)
    };
  }

  function gPadPhase(lat, long) {
    if (Math.abs(lat) < 0.02) {
      if (long < -0.10) {
        return '制动 / BRAKING';
      }
      if (long > 0.10) {
        return '加速 / ACCELERATING';
      }
      return '直行 / STRAIGHT';
    }
    if (long < -0.25) {
      return '入弯 / TURN-IN';
    }
    if (Math.abs(lat) >= 0.88 && Math.abs(long) <= 0.30) {
      return '弯心 / APEX';
    }
    if (long > 0.18) {
      return '出弯 / EXIT';
    }
    return '弯中 / MID';
  }

  function buildGPad() {
    var grid = $('gPadGrid');
    var axes = $('gPadAxes');
    var guide = $('gPadCornerGuide');
    if (!grid || !axes || !guide) {
      return;
    }

    clearSvgGroup(grid);
    clearSvgGroup(axes);

    var plotWidth = G_PAD.width - G_PAD.left - G_PAD.right;
    var plotHeight = G_PAD.bottom - G_PAD.top;

    axes.appendChild(createSvgElement('rect', {
      x: G_PAD.left,
      y: G_PAD.top,
      width: plotWidth,
      height: plotHeight,
      class: 'g-pad-frame'
    }));

    for (var value = G_PAD.gMin; value <= G_PAD.gMax + 1e-6; value += 0.5) {
      var rounded = Math.round(value);
      var isWhole = Math.abs(value - rounded) < 1e-6;
      var px = gPadX(value);
      var py = gPadY(value);

      grid.appendChild(createSvgElement('line', {
        x1: px.toFixed(2),
        y1: G_PAD.top,
        x2: px.toFixed(2),
        y2: G_PAD.bottom
      }));
      grid.appendChild(createSvgElement('line', {
        x1: G_PAD.left,
        y1: py.toFixed(2),
        x2: G_PAD.width - G_PAD.right,
        y2: py.toFixed(2)
      }));

      if (isWhole) {
        axes.appendChild(createSvgElement('text', {
          x: px.toFixed(2),
          y: G_PAD.bottom + 13,
          'text-anchor': 'middle'
        }, rounded === 0 ? '0' : String(rounded)));
        axes.appendChild(createSvgElement('text', {
          x: G_PAD.left - 5,
          y: (py + 3).toFixed(2),
          'text-anchor': 'end'
        }, rounded === 0 ? '0' : String(rounded)));
      }
    }

    axes.appendChild(createSvgElement('line', {
      x1: gPadX(0).toFixed(2),
      y1: G_PAD.top,
      x2: gPadX(0).toFixed(2),
      y2: G_PAD.bottom,
      class: 'g-pad-zero-axis'
    }));
    axes.appendChild(createSvgElement('line', {
      x1: G_PAD.left,
      y1: gPadY(0).toFixed(2),
      x2: G_PAD.width - G_PAD.right,
      y2: gPadY(0).toFixed(2),
      class: 'g-pad-zero-axis'
    }));

    axes.appendChild(createSvgElement('text', {
      x: G_PAD.left,
      y: G_PAD.top - 4,
      'text-anchor': 'start',
      class: 'g-pad-axis-title'
    }, 'LONG G · ↑ BRAKE / ↓ ACCEL'));
    axes.appendChild(createSvgElement('text', {
      x: G_PAD.left,
      y: G_PAD.height - 3,
      'text-anchor': 'start',
      class: 'g-pad-axis-title'
    }, '← LEFT'));
    axes.appendChild(createSvgElement('text', {
      x: G_PAD.left + plotWidth / 2,
      y: G_PAD.height - 3,
      'text-anchor': 'middle',
      class: 'g-pad-axis-title'
    }, 'LATERAL G'));
    axes.appendChild(createSvgElement('text', {
      x: G_PAD.width - G_PAD.right,
      y: G_PAD.height - 3,
      'text-anchor': 'end',
      class: 'g-pad-axis-title'
    }, 'RIGHT →'));

    var guidePoints = [];
    for (var i = 0; i <= 100; i += 1) {
      guidePoints.push(cornerPointAt(i / 100));
    }
    guide.setAttribute('d', gPadPath(guidePoints));
  }

  function sampleColorStops(stops, u) {
    var clamped = clamp(u, 0, 1);
    for (var i = 1; i < stops.length; i += 1) {
      if (clamped <= stops[i][0]) {
        var low = stops[i - 1];
        var high = stops[i];
        var span = high[0] - low[0];
        var fraction = span > 0 ? (clamped - low[0]) / span : 0;
        return [
          low[1][0] + (high[1][0] - low[1][0]) * fraction,
          low[1][1] + (high[1][1] - low[1][1]) * fraction,
          low[1][2] + (high[1][2] - low[1][2]) * fraction
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  function buildHeatColorLut() {
    var iceStops = [
      [0.00, [3, 6, 8]],
      [0.20, [4, 22, 28]],
      [0.45, [8, 70, 80]],
      [0.70, [30, 140, 152]],
      [0.90, [80, 205, 215]],
      [1.00, [150, 245, 250]]
    ];
    var fireStops = [
      [0.00, [5, 4, 4]],
      [0.20, [28, 8, 6]],
      [0.45, [95, 26, 10]],
      [0.70, [180, 65, 18]],
      [0.90, [240, 120, 35]],
      [1.00, [255, 175, 70]]
    ];
    var lut = new Uint8ClampedArray(256 * 4);

    for (var i = 0; i < 256; i += 1) {
      var t = (i / 255) * 2 - 1;
      var color = sampleColorStops(
        t >= 0 ? iceStops : fireStops,
        Math.pow(Math.abs(t), 0.88)
      );
      lut[i * 4] = Math.round(color[0]);
      lut[i * 4 + 1] = Math.round(color[1]);
      lut[i * 4 + 2] = Math.round(color[2]);
      lut[i * 4 + 3] = 255;
    }
    return lut;
  }

  function buildGRegions() {
    var canvas = $('gPadRegionCanvas');
    if (!canvas) {
      return;
    }
    var pixelRatio = 2;
    canvas.width = G_PAD.width * pixelRatio;
    canvas.height = G_PAD.height * pixelRatio;

    var plotWidth = G_PAD.width - G_PAD.left - G_PAD.right;
    var plotHeight = G_PAD.bottom - G_PAD.top;
    gRegionSampleCanvas = document.createElement('canvas');
    gRegionSampleCanvas.width = plotWidth;
    gRegionSampleCanvas.height = plotHeight;
    gRegionSampleContext = gRegionSampleCanvas.getContext('2d');
    if (gRegionSampleContext) {
      gRegionSampleImage = gRegionSampleContext.createImageData(
        plotWidth,
        plotHeight
      );
    }
    gHeatColorLut = buildHeatColorLut();
  }

  function markGRegionsDirty() {
    gRegionsDirty = true;
  }

  function refreshGRegions() {
    var canvas = $('gPadRegionCanvas');
    if (!canvas) {
      return;
    }
    if (!gHeatColorLut || !gRegionSampleCanvas || !gRegionSampleImage) {
      buildGRegions();
    }
    if (!gHeatColorLut || !gRegionSampleCanvas || !gRegionSampleImage) {
      return;
    }

    var context = canvas.getContext('2d');
    var imageContext = gRegionSampleContext;
    if (!context || !imageContext) {
      return;
    }

    gRegionsDirty = false;

    var count = Math.round((G_PAD.gMax - G_PAD.gMin) / G_REGION_STEP);
    var side = count + 1;
    var nodeValues = new Float32Array(side * side);
    var nodeLimits = new Uint8Array(side * side);
    var nodeFrontUtil = new Float32Array(side * side);
    var nodeRearUtil = new Float32Array(side * side);
    var nodeStateIndex = new Uint8Array(side * side);

    for (var row = 0; row <= count; row += 1) {
      var long = G_PAD.gMin + row * G_REGION_STEP;
      for (var column = 0; column <= count; column += 1) {
        var lat = G_PAD.gMin + column * G_REGION_STEP;
        var result = model.calculate(Object.assign({}, state, {
          lateralG: lat,
          longitudinalG: long
        }));
        var delta = result.deltaPP;
        var nodeIndex = row * side + column;
        nodeValues[nodeIndex] = Number.isFinite(delta)
          ? Math.max(-100000, Math.min(100000, delta))
          : 0;
        nodeLimits[nodeIndex] =
          result.limitExceeded || result.axleLimitReached || result.wheelLift.any
            ? 1
            : 0;
        nodeFrontUtil[nodeIndex] = Number.isFinite(result.utilisation.front)
          ? Math.min(4, Math.max(0, result.utilisation.front))
          : 4;
        nodeRearUtil[nodeIndex] = Number.isFinite(result.utilisation.rear)
          ? Math.min(4, Math.max(0, result.utilisation.rear))
          : 4;
        nodeStateIndex[nodeIndex] = result.vehicleState
          ? (G_STATE_INDEX[result.vehicleState.code] || 0)
          : 0;
      }
    }

    var imageWidth = gRegionSampleCanvas.width;
    var imageHeight = gRegionSampleCanvas.height;
    var pixels = gRegionSampleImage.data;
    var dataIndex = 0;
    var range = G_PAD.gMax - G_PAD.gMin;
    var pixelStates = new Uint8Array(imageWidth * imageHeight);

    for (var py = 0; py < imageHeight; py += 1) {
      // Row 0 is the top of the plot: maximum braking (-G long).
      var longValue = G_PAD.gMin + (py / (imageHeight - 1)) * range;
      var fy = (longValue - G_PAD.gMin) / G_REGION_STEP;
      var y0 = Math.min(count, Math.floor(fy));
      var y1 = Math.min(count, y0 + 1);
      var ty = fy - y0;

      for (var px = 0; px < imageWidth; px += 1) {
        var latValue = G_PAD.gMin + (px / (imageWidth - 1)) * range;
        var fx = (latValue - G_PAD.gMin) / G_REGION_STEP;
        var x0 = Math.min(count, Math.floor(fx));
        var x1 = Math.min(count, x0 + 1);
        var tx = fx - x0;

        var v00 = nodeValues[y0 * side + x0];
        var v10 = nodeValues[y0 * side + x1];
        var v01 = nodeValues[y1 * side + x0];
        var v11 = nodeValues[y1 * side + x1];
        var v0 = v00 + (v10 - v00) * tx;
        var v1 = v01 + (v11 - v01) * tx;
        var value = v0 + (v1 - v0) * ty;

        var f00 = nodeFrontUtil[y0 * side + x0];
        var f10 = nodeFrontUtil[y0 * side + x1];
        var f01 = nodeFrontUtil[y1 * side + x0];
        var f11 = nodeFrontUtil[y1 * side + x1];
        var rf0 = f00 + (f10 - f00) * tx;
        var rf1 = f01 + (f11 - f01) * tx;
        var frontUtilValue = rf0 + (rf1 - rf0) * ty;

        var r00 = nodeRearUtil[y0 * side + x0];
        var r10 = nodeRearUtil[y0 * side + x1];
        var r01 = nodeRearUtil[y1 * side + x0];
        var r11 = nodeRearUtil[y1 * side + x1];
        var rr0 = r00 + (r10 - r00) * tx;
        var rr1 = r01 + (r11 - r01) * tx;
        var rearUtilValue = rr0 + (rr1 - rr0) * ty;

        var l00 = nodeLimits[y0 * side + x0];
        var l10 = nodeLimits[y0 * side + x1];
        var l01 = nodeLimits[y1 * side + x0];
        var l11 = nodeLimits[y1 * side + x1];
        var l0 = l00 + (l10 - l00) * tx;
        var l1 = l01 + (l11 - l01) * tx;
        var limitCoverage = l0 + (l1 - l0) * ty;
        var maskX = clamp((limitCoverage - 0.30) / 0.45, 0, 1);
        var heatAlpha = 1 - (maskX * maskX * (3 - 2 * maskX));

        var vehicleState = model.classifyVehicleState(
          frontUtilValue,
          rearUtilValue,
          longValue
        );
        var stateColor = vehicleState ? G_STATE_COLORS[vehicleState.code] : null;

        var t = Math.tanh(value / G_DELTA_SCALE_PP);
        var lutIndex = clamp(Math.round((t + 1) * 127.5), 0, 255);
        var colorIndex = lutIndex * 4;
        var baseR = gHeatColorLut[colorIndex];
        var baseG = gHeatColorLut[colorIndex + 1];
        var baseB = gHeatColorLut[colorIndex + 2];

        pixelStates[py * imageWidth + px] = vehicleState
          ? (G_STATE_INDEX[vehicleState.code] || 0)
          : 0;

        if (stateColor) {
          // Keep the state as a faint categorical wash; the bright contour and
          // label carry the state while the field stays readable.
          pixels[dataIndex] = Math.round(baseR * 0.05 + stateColor[0] * 0.95);
          pixels[dataIndex + 1] = Math.round(baseG * 0.05 + stateColor[1] * 0.95);
          pixels[dataIndex + 2] = Math.round(baseB * 0.05 + stateColor[2] * 0.95);
          pixels[dataIndex + 3] = 52;
        } else {
          pixels[dataIndex] = baseR;
          pixels[dataIndex + 1] = baseG;
          pixels[dataIndex + 2] = baseB;
          pixels[dataIndex + 3] = Math.round(255 * heatAlpha);
        }
        dataIndex += 4;
      }
    }

    // Bright one-pixel contours make each state region legible without hiding
    // the rest of the field.
    for (var borderPy = 0; borderPy < imageHeight; borderPy += 1) {
      for (var borderPx = 0; borderPx < imageWidth; borderPx += 1) {
        var borderIndex = borderPy * imageWidth + borderPx;
        var borderState = pixelStates[borderIndex];
        if (!borderState) {
          continue;
        }
        var isBoundary =
          (borderPx > 0 && pixelStates[borderIndex - 1] !== borderState) ||
          (borderPx < imageWidth - 1 && pixelStates[borderIndex + 1] !== borderState) ||
          (borderPy > 0 && pixelStates[borderIndex - imageWidth] !== borderState) ||
          (borderPy < imageHeight - 1 && pixelStates[borderIndex + imageWidth] !== borderState);
        if (!isBoundary) {
          continue;
        }
        var borderColor = G_STATE_COLORS[G_STATE_ORDER[borderState - 1]];
        if (!borderColor) {
          continue;
        }
        var borderDataIndex = borderIndex * 4;
        pixels[borderDataIndex] = borderColor[0];
        pixels[borderDataIndex + 1] = borderColor[1];
        pixels[borderDataIndex + 2] = borderColor[2];
        pixels[borderDataIndex + 3] = 255;
      }
    }

    imageContext.putImageData(gRegionSampleImage, 0, 0);

    var pixelRatio = 2;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, G_PAD.width, G_PAD.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      gRegionSampleCanvas,
      G_PAD.left,
      G_PAD.top,
      imageWidth,
      imageHeight
    );

    updateGStateLabels(nodeStateIndex, side, count);
  }

  function updateGStateLabels(nodeStateIndex, side, count) {
    var group = $('gPadStateLabels');
    if (!group) {
      return;
    }
    clearSvgGroup(group);

    var seen = new Uint8Array(nodeStateIndex.length);
    var candidates = [];
    var total = nodeStateIndex.length;

    for (var start = 0; start < total; start += 1) {
      var target = nodeStateIndex[start];
      if (!target || seen[start]) {
        continue;
      }

      var stack = [start];
      var nodes = [];
      seen[start] = 1;
      var rowSum = 0;
      var columnSum = 0;

      while (stack.length) {
        var current = stack.pop();
        nodes.push(current);
        var currentRow = Math.floor(current / side);
        var currentColumn = current % side;
        rowSum += currentRow;
        columnSum += currentColumn;

        if (currentRow > 0) {
          var up = current - side;
          if (!seen[up] && nodeStateIndex[up] === target) {
            seen[up] = 1;
            stack.push(up);
          }
        }
        if (currentRow < side - 1) {
          var down = current + side;
          if (!seen[down] && nodeStateIndex[down] === target) {
            seen[down] = 1;
            stack.push(down);
          }
        }
        if (currentColumn > 0) {
          var left = current - 1;
          if (!seen[left] && nodeStateIndex[left] === target) {
            seen[left] = 1;
            stack.push(left);
          }
        }
        if (currentColumn < side - 1) {
          var right = current + 1;
          if (!seen[right] && nodeStateIndex[right] === target) {
            seen[right] = 1;
            stack.push(right);
          }
        }
      }

      var meanRow = rowSum / nodes.length;
      var meanColumn = columnSum / nodes.length;
      var bestNode = nodes[0];
      var bestDistance = Infinity;
      nodes.forEach(function (node) {
        var distance = Math.pow(Math.floor(node / side) - meanRow, 2) +
          Math.pow((node % side) - meanColumn, 2);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestNode = node;
        }
      });

      var labelRow = Math.floor(bestNode / side);
      var labelColumn = bestNode % side;
      candidates.push({
        code: G_STATE_ORDER[target - 1],
        size: nodes.length,
        x: gPadX(G_PAD.gMin + labelColumn * G_REGION_STEP),
        y: gPadY(G_PAD.gMin + labelRow * G_REGION_STEP)
      });
    }

    candidates.sort(function (a, b) {
      return b.size - a.size;
    });

    var placed = [];
    var labelCount = 0;
    var perStateCount = {};
    var offsets = [
      [0, 0], [0, -15], [0, 15], [-18, 0], [18, 0],
      [-18, -14], [18, -14], [-18, 14], [18, 14]
    ];
    candidates.forEach(function (candidate) {
      if (labelCount >= 7) {
        return;
      }
      var stateCount = perStateCount[candidate.code] || 0;
      if (stateCount >= 1) {
        return;
      }
      var baseX = clamp(
        candidate.x,
        G_PAD.left + 22,
        G_PAD.width - G_PAD.right - 22
      );
      var baseY = clamp(
        candidate.y + 3,
        G_PAD.top + 12,
        G_PAD.bottom - 8
      );
      var x = null;
      var y = null;
      for (var offsetIndex = 0; offsetIndex < offsets.length; offsetIndex += 1) {
        var testX = clamp(
          baseX + offsets[offsetIndex][0],
          G_PAD.left + 22,
          G_PAD.width - G_PAD.right - 22
        );
        var testY = clamp(
          baseY + offsets[offsetIndex][1],
          G_PAD.top + 12,
          G_PAD.bottom - 8
        );
        var collides = false;
        for (var i = 0; i < placed.length; i += 1) {
          if (Math.hypot(placed[i].x - testX, placed[i].y - testY) < 42) {
            collides = true;
            break;
          }
        }
        if (!collides) {
          x = testX;
          y = testY;
          break;
        }
      }
      if (x === null) {
        return;
      }
      var color = G_STATE_COLORS[candidate.code];
      if (!color) {
        return;
      }
      placed.push({ x: x, y: y });
      perStateCount[candidate.code] = stateCount + 1;
      labelCount += 1;

      var label = createSvgElement('text', {
        x: x.toFixed(2),
        y: y.toFixed(2),
        class: 'g-pad-state-label',
        'data-state': candidate.code,
        fill: 'rgb(' + color[0] + ', ' + color[1] + ', ' + color[2] + ')'
      }, G_STATE_LABELS[candidate.code] || candidate.code);
      group.appendChild(label);
    });
  }

  function refreshGRegionsIfNeeded() {
    if (gRegionsDirty) {
      refreshGRegions();
    }
  }

  function clearGTrail() {
    gTrail = [];
    gLastTrailPoint = null;
    var trail = $('gPadTrail');
    if (trail) {
      trail.setAttribute('d', '');
    }
  }

  function recordGTrail(lat, long) {
    if (gLastTrailPoint &&
      Math.abs(gLastTrailPoint.lat - lat) < 0.003 &&
      Math.abs(gLastTrailPoint.long - long) < 0.003) {
      return false;
    }

    gLastTrailPoint = { lat: lat, long: long };
    gTrail.push(gLastTrailPoint);
    if (gTrail.length > 220) {
      gTrail.shift();
    }

    var trail = $('gPadTrail');
    if (trail) {
      trail.setAttribute('d', gPadPath(gTrail));
    }
    return true;
  }

  function updateGPad(result) {
    var pad = $('gPad');
    if (!pad) {
      return;
    }

    var lat = result.state.lateralG;
    var long = result.state.longitudinalG;
    var magnitude = result.gVectorMagnitude;
    var phase = gPadPhase(lat, long);
    var transferKn = result.longitudinal.transfer / 1000;
    var hasCorner = Math.abs(lat) >= 0.02;
    var directionCn = result.turnDirection === 'right'
      ? '右转'
      : result.turnDirection === 'left' ? '左转' : '直行';
    var directionEn = result.turnDirection === 'right'
      ? 'RIGHT'
      : result.turnDirection === 'left' ? 'LEFT' : 'STRAIGHT';

    recordGTrail(lat, long);

    var px = gPadX(lat);
    var py = gPadY(long);

    var cursor = $('gPadCursor');
    var halo = $('gPadCursorHalo');
    if (cursor) {
      cursor.setAttribute('cx', px.toFixed(2));
      cursor.setAttribute('cy', py.toFixed(2));
    }
    if (halo) {
      halo.setAttribute('cx', px.toFixed(2));
      halo.setAttribute('cy', py.toFixed(2));
    }

    var projectionX = $('gPadProjectionX');
    if (projectionX) {
      projectionX.setAttribute('x1', px.toFixed(2));
      projectionX.setAttribute('y1', py.toFixed(2));
      projectionX.setAttribute('x2', px.toFixed(2));
      projectionX.setAttribute('y2', G_PAD.bottom);
    }
    var projectionY = $('gPadProjectionY');
    if (projectionY) {
      projectionY.setAttribute('x1', G_PAD.left);
      projectionY.setAttribute('y1', py.toFixed(2));
      projectionY.setAttribute('x2', px.toFixed(2));
      projectionY.setAttribute('y2', py.toFixed(2));
    }

    setText('ayValue', formatSigned(lat, 2));
    setText('longGValue', formatSigned(long, 2));
    setText('gMagValue', magnitude.toFixed(2));
    setText('radiusValue', hasCorner
      ? Math.round(result.cornerRadiusM) + ' m'
      : '—');
    setText('gPhaseBadge', phase);
    updateVehicleStateBadge(result);
    setText('gLongTransferNote',
      '纵向转移 后轴 ' + formatSigned(transferKn, 2) + ' kN');

    setText('sceneAyValue', formatSigned(lat, 2));
    setText('sceneLongGValue', formatSigned(long, 2));
    setText('sceneGTotalValue', magnitude.toFixed(2));
    setText('sceneRadiusValue', hasCorner
      ? String(Math.round(result.cornerRadiusM))
      : '—');
    setText('scenePhaseText',
      result.turnDirection === 'straight' ? phase : directionCn + ' · ' + phase);
    setText('gVectorValue', magnitude.toFixed(2));
    setText('mobileGValue', magnitude.toFixed(2));
    setText('mobileLongGValue', formatSigned(long, 2));
    setText('sceneLongTransferValue', formatSigned(transferKn, 2));

    var gLabel = document.querySelector('[data-g-label]');
    if (gLabel) {
      gLabel.title = 'G 箭头长度 = 合成 G；方向表示惯性力（外侧 / 加速向后）。';
    }

    pad.setAttribute('aria-label',
      '二维 G-G 输入。侧向 ' + formatSigned(lat, 2) + ' g（' + directionEn +
      '），纵向 ' + formatSigned(long, 2) + ' g，合成 ' + magnitude.toFixed(2) +
      ' g，阶段 ' + phase + '。拖动或使用方向键调整。');
  }

  function updateVehicleStateBadge(result) {
    var badge = $('gVehicleState');
    var code;
    var label;
    var labelEn;
    var description;

    if (result.vehicleState) {
      code = result.vehicleState.code;
      label = result.vehicleState.label;
      labelEn = result.vehicleState.labelEn;
      description = G_STATE_DESCRIPTIONS[code] || '';
    } else {
      code = 'grip';
      label = '抓地内';
      labelEn = 'WITHIN GRIP';
      description = '两轴联合利用率均低于 100%';
    }

    if (badge) {
      badge.setAttribute('data-state', code);
      badge.setAttribute('aria-label',
        label + ' / ' + labelEn + '，' + description);
    }
    setText('gVehicleStateLabel', label);
    setText('gVehicleStateEn', labelEn);
    setText('gVehicleStateDesc', description);
  }

  function setGInput(lat, long) {
    state.lateralG = clamp(
      lat,
      model.LIMITS.lateralG[0],
      model.LIMITS.lateralG[1]
    );
    state.longitudinalG = clamp(
      long,
      model.LIMITS.longitudinalG[0],
      model.LIMITS.longitudinalG[1]
    );
    clearAutoNote();
    render();
  }

  function stopGPlayback(finished) {
    gPlaying = false;
    if (gPlayFrame) {
      window.cancelAnimationFrame(gPlayFrame);
      gPlayFrame = null;
    }
    var button = $('gPlayButton');
    var label = $('gPlayLabel');
    if (button) {
      button.classList.remove('is-playing');
      button.setAttribute('aria-pressed', 'false');
    }
    if (label) {
      label.textContent = finished ? '再放一次' : '扫弯回放';
    }
  }

  function startGPlayback() {
    if (gPlaying) {
      stopGPlayback(false);
      return;
    }

    clearAutoNote();
    clearGTrail();
    gPlaying = true;
    gPlayStart = 0;
    gPlayLastRender = 0;

    var button = $('gPlayButton');
    var label = $('gPlayLabel');
    if (button) {
      button.classList.add('is-playing');
      button.setAttribute('aria-pressed', 'true');
    }
    if (label) {
      label.textContent = '停止回放';
    }

    function step(now) {
      if (!gPlaying) {
        return;
      }
      if (!gPlayStart) {
        gPlayStart = now;
      }
      var progress = Math.min(1, (now - gPlayStart) / G_PLAY_DURATION_MS);

      if (now - gPlayLastRender >= 32 || progress >= 1) {
        gPlayLastRender = now;
        var point = cornerPointAt(progress);
        state.lateralG = point.lat;
        state.longitudinalG = point.long;
        render();
      }

      if (progress < 1) {
        gPlayFrame = window.requestAnimationFrame(step);
      } else {
        stopGPlayback(true);
      }
    }

    gPlayFrame = window.requestAnimationFrame(step);
  }

  function bindGPad() {
    var pad = $('gPad');
    if (!pad) {
      return;
    }
    var svg = $('gPadSvg');

    function applyPointer(event) {
      var rect = svg.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) {
        return;
      }
      var px = (event.clientX - rect.left) * (G_PAD.width / rect.width);
      var py = (event.clientY - rect.top) * (G_PAD.height / rect.height);
      px = clamp(px, G_PAD.left, G_PAD.width - G_PAD.right);
      py = clamp(py, G_PAD.top, G_PAD.bottom);

      var lat = G_PAD.gMin +
        ((px - G_PAD.left) / (G_PAD.width - G_PAD.left - G_PAD.right)) *
        (G_PAD.gMax - G_PAD.gMin);
      var long = G_PAD.gMin +
        ((py - G_PAD.top) / (G_PAD.bottom - G_PAD.top)) *
        (G_PAD.gMax - G_PAD.gMin);

      setGInput(Math.round(lat * 100) / 100, Math.round(long * 100) / 100);
    }

    pad.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      stopGPlayback(false);
      gPadDragging = true;
      gPadPointerId = event.pointerId;
      if (pad.setPointerCapture) {
        pad.setPointerCapture(event.pointerId);
      }
      try {
        pad.focus({ preventScroll: true });
      } catch (error) {
        pad.focus();
      }
      applyPointer(event);
    });

    pad.addEventListener('pointermove', function (event) {
      if (!gPadDragging || event.pointerId !== gPadPointerId) {
        return;
      }
      event.preventDefault();
      applyPointer(event);
    });

    function releasePointer(event) {
      if (event.pointerId !== gPadPointerId) {
        return;
      }
      gPadDragging = false;
      if (pad.hasPointerCapture && pad.hasPointerCapture(event.pointerId)) {
        pad.releasePointerCapture(event.pointerId);
      }
      gPadPointerId = null;
    }

    pad.addEventListener('pointerup', releasePointer);
    pad.addEventListener('pointercancel', releasePointer);

    pad.addEventListener('keydown', function (event) {
      var step = event.shiftKey ? 0.05 : 0.01;
      var lat = state.lateralG;
      var long = state.longitudinalG;
      var handled = true;

      switch (event.key) {
        case 'ArrowLeft':
          lat -= step;
          break;
        case 'ArrowRight':
          lat += step;
          break;
        case 'ArrowUp':
          long -= step;
          break;
        case 'ArrowDown':
          long += step;
          break;
        default:
          handled = false;
      }

      if (!handled) {
        return;
      }
      event.preventDefault();
      stopGPlayback(false);
      setGInput(
        Math.round(lat * 100) / 100,
        Math.round(long * 100) / 100
      );
    });

    var playButton = $('gPlayButton');
    if (playButton) {
      playButton.addEventListener('click', startGPlayback);
    }

    var clearButton = $('gClearTrailButton');
    if (clearButton) {
      clearButton.addEventListener('click', function () {
        stopGPlayback(false);
        clearGTrail();
        render();
      });
    }
  }

  function syncControls() {
    parameterElements.forEach(function (element) {
      var key = element.getAttribute('data-param');
      if (!(key in state)) {
        return;
      }

      if (element === document.activeElement && element.type === 'number') {
        updateRangeFill(element);
        return;
      }

      var value = state[key];
      element.value = element.type === 'number' ? formatInputValue(value) : String(value);
      updateRangeFill(element);
    });

    var frontWeightInput = $('frontWeightPct');
    if (frontWeightInput && frontWeightInput !== document.activeElement) {
      frontWeightInput.value = formatNumber(state.frontWeight * 100, 1);
    }

    rangeElements.forEach(updateRangeFill);
  }

  function clearAutoNote() {
    if (autoNoteTimer) {
      window.clearTimeout(autoNoteTimer);
      autoNoteTimer = null;
    }
    var note = $('autoBalanceNote');
    if (note) {
      note.textContent = '';
    }
  }

  function buildGaugeTicks() {
    var group = $('gaugeTicks');
    if (!group) {
      return;
    }
    var ns = 'http://www.w3.org/2000/svg';
    var centerX = 150;
    var centerY = 142;

    for (var i = 0; i <= 8; i += 1) {
      var angle = Math.PI - (i / 8) * Math.PI;
      var inner = i === 4 ? 101 : 104;
      var outer = 112;
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', (centerX + Math.cos(angle) * inner).toFixed(2));
      line.setAttribute('y1', (centerY - Math.sin(angle) * inner).toFixed(2));
      line.setAttribute('x2', (centerX + Math.cos(angle) * outer).toFixed(2));
      line.setAttribute('y2', (centerY - Math.sin(angle) * outer).toFixed(2));
      if (i === 4) {
        line.setAttribute('class', 'is-center');
      } else if (i % 2 === 0) {
        line.setAttribute('class', 'is-major');
      }
      group.appendChild(line);
    }
  }

  function updateWheelLabels(result) {
    var loadMap = {
      FL: result.wheelLoads.FL,
      FR: result.wheelLoads.FR,
      RL: result.wheelLoads.RL,
      RR: result.wheelLoads.RR
    };
    var staticMap = {
      FL: result.staticLoads.frontWheel,
      FR: result.staticLoads.frontWheel,
      RL: result.staticLoads.rearWheel,
      RR: result.staticLoads.rearWheel
    };

    function sideText(wheelId) {
      if (result.outerSide === 'none') {
        return '直行';
      }
      var isLeftWheel = wheelId === 'FL' || wheelId === 'RL';
      var isOuter = (result.outerSide === 'left' && isLeftWheel) ||
        (result.outerSide === 'right' && !isLeftWheel);
      return isOuter ? '外侧' : '内侧';
    }

    ['FL', 'FR', 'RL', 'RR'].forEach(function (wheelId) {
      var element = document.querySelector('[data-wheel-load="' + wheelId + '"]');
      if (element) {
        element.textContent = formatForce(loadMap[wheelId]);
      }

      var staticLoad = staticMap[wheelId];
      var changePct = staticLoad > 0 ? ((loadMap[wheelId] - staticLoad) / staticLoad) * 100 : 0;
      var deltaElement = document.querySelector('[data-wheel-delta="' + wheelId + '"]');
      if (deltaElement) {
        var sign = changePct > 0.05 ? '+' : changePct < -0.05 ? '−' : '';
        deltaElement.textContent = '(' + sign + Math.abs(changePct).toFixed(1) + '%)';
      }

      var sideElement = document.querySelector('[data-wheel-side="' + wheelId + '"]');
      if (sideElement) {
        sideElement.textContent = sideText(wheelId);
      }

      var label = document.querySelector('[data-wheel-label="' + wheelId + '"]');
      if (label) {
        label.classList.toggle('is-lifted', loadMap[wheelId] <= 1e-6);
      }
    });
  }

  function updateWarnings(result) {
    var container = $('warnings');
    if (!container) {
      return;
    }
    container.innerHTML = '';

    result.warnings.forEach(function (warning) {
      var item = document.createElement('div');
      item.className = 'warning' + (warning.severity === 'danger' ? ' warning--danger' : '');

      var text = document.createElement('div');
      var title = document.createElement('strong');
      title.textContent = warning.title;
      var detail = document.createElement('span');
      detail.textContent = warning.detail;
      text.appendChild(title);
      text.appendChild(detail);
      item.appendChild(text);
      container.appendChild(item);
    });
  }

  function updateExplanation(result) {
    var element = $('balanceExplanation');
    if (!element) {
      return;
    }

    var delta = Math.abs(result.deltaPP).toFixed(1);
    var frontShare = (result.rollStiffness.frontShare * 100).toFixed(1);
    var rearShare = (result.rollStiffness.rearShare * 100).toFixed(1);

    var frontTransferPct = (result.loadTransferRatio.front * 100).toFixed(1);
    var rearTransferPct = (result.loadTransferRatio.rear * 100).toFixed(1);

    if (result.balance === 'understeer') {
      var frontMuOuter = result.tyreGrip.frontOuter.mu;
      var frontMuInner = result.tyreGrip.frontInner.mu;
      element.innerHTML =
        '前轴侧倾刚度占比 <strong>' + frontShare + '%</strong>，前轴产生 <strong>' +
        formatForce(result.frontLoadTransfer) + ' kN（' + frontTransferPct + '% Fz）</strong> 的侧向载荷转移。' +
        '外侧前轮加载后 μ 降至 <strong>' + formatNumber(frontMuOuter, 3) +
        '</strong>（内侧 ' + formatNumber(frontMuInner, 3) + '），前轴总抓地力 <strong>' +
        formatForce(result.grip.front) + ' kN</strong>。' +
        '前轴合成需求 <strong>' + formatForce(result.demand.front) +
        ' kN</strong>（Fx ' + formatSigned(result.longitudinalDemand.front / 1000, 2) +
        ' / Fy ' + formatForce(result.lateralDemand.front) + '），联合利用率高出后轴 <strong>' +
        delta + ' pp</strong>，前轮先到极限。';
    } else if (result.balance === 'oversteer') {
      var rearMuOuter = result.tyreGrip.rearOuter.mu;
      var rearMuInner = result.tyreGrip.rearInner.mu;
      element.innerHTML =
        '后轴侧倾刚度占比 <strong>' + rearShare + '%</strong>，后轴产生 <strong>' +
        formatForce(result.rearLoadTransfer) + ' kN（' + rearTransferPct + '% Fz）</strong> 的侧向载荷转移。' +
        '外侧后轮加载后 μ 降至 <strong>' + formatNumber(rearMuOuter, 3) +
        '</strong>（内侧 ' + formatNumber(rearMuInner, 3) + '），后轴总抓地力 <strong>' +
        formatForce(result.grip.rear) + ' kN</strong>。' +
        '后轴合成需求 <strong>' + formatForce(result.demand.rear) +
        ' kN</strong>（Fx ' + formatSigned(result.longitudinalDemand.rear / 1000, 2) +
        ' / Fy ' + formatForce(result.lateralDemand.rear) + '），联合利用率高出前轴 <strong>' +
        delta + ' pp</strong>，后轮先到极限。';
    } else {
      element.innerHTML =
        '前后轴联合利用率差仅 <strong>' + delta + ' pp</strong>，两轴接近同时达到极限。' +
        '当前侧倾刚度分配为前 <strong>' + frontShare + '%</strong> / 后 <strong>' + rearShare + '%</strong>。';
    }
  }

  function updateCards(result) {
    setText('frontGripValue', formatForce(result.grip.front));
    setText('rearGripValue', formatForce(result.grip.rear));
    setText('frontDemandValue', formatForce(result.demand.front));
    setText('rearDemandValue', formatForce(result.demand.rear));
    setText('frontLongForceValue',
      formatSigned(result.longitudinalDemand.front / 1000, 2));
    setText('rearLongForceValue',
      formatSigned(result.longitudinalDemand.rear / 1000, 2));
    setText('frontLatForceValue', formatForce(result.lateralDemand.front));
    setText('rearLatForceValue', formatForce(result.lateralDemand.rear));

    var frontReserve = result.margin.front;
    var rearReserve = result.margin.rear;
    var frontReserveElement = $('frontReserveValue');
    var rearReserveElement = $('rearReserveValue');

    if (frontReserveElement) {
      frontReserveElement.textContent = (frontReserve >= 0 ? '+' : '−') +
        Math.abs(frontReserve / 1000).toFixed(2);
      frontReserveElement.classList.toggle('is-over', frontReserve < 0);
    }
    if (rearReserveElement) {
      rearReserveElement.textContent = (rearReserve >= 0 ? '+' : '−') +
        Math.abs(rearReserve / 1000).toFixed(2);
      rearReserveElement.classList.toggle('is-over', rearReserve < 0);
    }

    setText('frontTransferPct', (result.loadTransferRatio.front * 100).toFixed(1));
    setText('rearTransferPct', (result.loadTransferRatio.rear * 100).toFixed(1));
    setText('frontTransferAbs', formatForce(result.frontLoadTransfer));
    setText('rearTransferAbs', formatForce(result.rearLoadTransfer));
  }

  function updateBalance(result) {
    var copy = COPY[result.balance] || COPY.neutral;
    var hero = $('statusHero');
    var limits = [];
    if (result.axleLimitReached) limits.push('AXLE LIMIT');
    if (result.limitExceeded) limits.push('GRIP LIMIT');

    document.documentElement.setAttribute('data-balance', result.balance);

    if (hero) {
      hero.setAttribute('data-state', result.balance);
    }

    setText('statusCn', copy.cn);
    setText('statusEn', copy.en);
    setText('statusKicker', copy.kicker + (limits.length ? ' · ' + limits.join(' / ') : ''));
    setText('statusSub', copy.sub);
    setText('tuningHint', copy.hint);

    var deltaElement = $('balanceDeltaValue');
    if (deltaElement) {
      deltaElement.textContent = formatSigned(result.deltaPP, 1);
    }

    var balanceMarker = $('balanceStripMarker');
    if (balanceMarker) {
      var balanceFraction = clamp((result.deltaPP + 8) / 16, 0, 1);
      balanceMarker.style.left = ((1 - balanceFraction) * 100).toFixed(2) + '%';
    }

    setBarWidth($('frontUtilBar'), result.utilisation.front);
    setBarWidth($('rearUtilBar'), result.utilisation.rear);
    setText('frontUtilValue', formatPercent(result.utilisation.front));
    setText('rearUtilValue', formatPercent(result.utilisation.rear));
    toggleClass($('frontUtilValue'), 'is-over', result.utilisation.front >= 1);
    toggleClass($('rearUtilValue'), 'is-over', result.utilisation.rear >= 1);

    setText('totalGripValue', formatForce(result.grip.total));
    setText('totalDemandValue', formatForce(result.demand.total));

    var headroom = $('totalHeadroomValue');
    if (headroom) {
      headroom.textContent = (result.margin.total >= 0 ? '余量 +' : '超限 −') +
        Math.abs(result.margin.total / 1000).toFixed(2) + ' kN';
      headroom.classList.toggle('is-over', result.margin.total < 0);
    }

    updateWarnings(result);
  }

  function updateLongitudinalUi() {
    var biasPct = Math.round(state.brakeBiasFront * 100);
    setText('brakeBiasReadout', '前 ' + biasPct + '% · 后 ' + (100 - biasPct) + '%');
    setText('driveTypeChip', state.driveType);
    setText('gDistributionNote', '制动 ' + biasPct + ' / ' + (100 - biasPct) + ' · ' + state.driveType);

    var driveSelect = $('driveTypeSelect');
    if (driveSelect && driveSelect.value !== state.driveType) {
      driveSelect.value = state.driveType;
    }
  }

  function updateConditionAndSetup(result) {
    setText('sceneRollValue', result.rollAngleDeg.toFixed(2));
    setText('sceneFrontShareValue', (result.rollStiffness.frontShare * 100).toFixed(1));
    setText('cogHeightValue', result.state.cgHeightM.toFixed(3));
    setText('mobileCogHeight', result.state.cgHeightM.toFixed(3));

    var frontShare = result.rollStiffness.frontShare * 100;
    var rearShare = 100 - frontShare;
    setText('splitFrontValue', frontShare.toFixed(1));
    setText('splitRearValue', rearShare.toFixed(1));
    setText('splitKValue', 'Kφ ' +
      (result.rollStiffness.front / 1000).toFixed(1) + ' / ' +
      (result.rollStiffness.rear / 1000).toFixed(1) + ' kNm/rad');

    var frontBar = $('splitFrontBar');
    var rearBar = $('splitRearBar');
    if (frontBar) frontBar.style.width = frontShare.toFixed(2) + '%';
    if (rearBar) rearBar.style.width = rearShare.toFixed(2) + '%';

    setText('frontStiffnessSummary', result.springRates.frontNmm.toFixed(1) + ' N/mm');
    setText('rearStiffnessSummary', result.springRates.rearNmm.toFixed(1) + ' N/mm');
  }

  function renderTyreCurve(result) {
    var svg = $('tyreCurveSvg');
    if (!svg) {
      return;
    }

    var gridGroup = $('tyreCurveGrid');
    var axesGroup = $('tyreCurveAxes');
    var pointsGroup = $('tyreCurvePoints');
    var frontPath = $('tyreCurveFront');
    var rearPath = $('tyreCurveRear');
    var note = $('tyreCurveNote');

    var width = 340;
    var height = 400;
    var margin = { left: 50, right: 12, top: 20, bottom: 42 };
    var plotWidth = width - margin.left - margin.right;
    var plotHeight = height - margin.top - margin.bottom;

    var tyreState = result.state;

    function muAtLoad(load, axle) {
      var muRef = axle === 'rear'
        ? tyreState.tireRearMuRef
        : tyreState.tireMuRef;
      var fz0N = axle === 'rear'
        ? tyreState.tireRearFz0N
        : tyreState.tireFz0N;
      var k = axle === 'rear'
        ? tyreState.tireRearLoadSensitivityK
        : tyreState.tireLoadSensitivityK;
      if (!(load > 0) || !(fz0N > 0)) {
        return 0;
      }
      return muRef * Math.pow(load / fz0N, -k);
    }

    var samples = TYRE_POINT_DEFS.map(function (definition) {
      var grip = result.wheelGrip[definition.code];
      var isLeftWheel = definition.code === 'FL' || definition.code === 'RL';
      var isOuter = result.outerSide !== 'none' &&
        ((result.outerSide === 'left' && isLeftWheel) ||
          (result.outerSide === 'right' && !isLeftWheel));
      return {
        definition: definition,
        load: grip.load,
        mu: grip.mu,
        capacity: grip.capacity,
        side: isOuter ? 'outer' : 'inner'
      };
    });

    var positiveSamples = samples.filter(function (sample) {
      return sample.load > 0;
    });
    var loadValues = positiveSamples.map(function (sample) {
      return sample.load;
    });

    var minLoad = loadValues.length ? Math.min.apply(null, loadValues) : 1800;
    var maxLoad = loadValues.length ? Math.max.apply(null, loadValues) : 4700;
    var xMin = Math.max(400, Math.floor(minLoad * 0.82 / 100) * 100);
    var xMax = Math.ceil(Math.max(maxLoad * 1.12, xMin + 1800) / 500) * 500;

    var yCandidates = [
      muAtLoad(xMin, 'front'),
      muAtLoad(xMax, 'front'),
      muAtLoad(xMin, 'rear'),
      muAtLoad(xMax, 'rear')
    ];
    samples.forEach(function (sample) {
      if (sample.mu > 0) {
        yCandidates.push(sample.mu);
      }
    });
    var rawYMin = Math.min.apply(null, yCandidates);
    var rawYMax = Math.max.apply(null, yCandidates);
    var yPad = Math.max(0.018, (rawYMax - rawYMin) * 0.14);
    var yStep = niceStep((rawYMax - rawYMin + yPad * 2) / 4);
    var yMin = Math.max(0, Math.floor((rawYMin - yPad) / yStep) * yStep);
    var yMax = Math.ceil((rawYMax + yPad) / yStep) * yStep;
    if (!(yMax > yMin)) {
      yMax = yMin + yStep * 2;
    }

    function xPixel(load) {
      return margin.left + ((load - xMin) / (xMax - xMin)) * plotWidth;
    }

    function yPixel(mu) {
      return margin.top + (1 - (mu - yMin) / (yMax - yMin)) * plotHeight;
    }

    clearSvgGroup(gridGroup);
    clearSvgGroup(axesGroup);
    clearSvgGroup(pointsGroup);

    // Highlight the range of loads the four tyres are currently operating in.
    if (maxLoad > minLoad) {
      gridGroup.appendChild(createSvgElement('rect', {
        x: xPixel(minLoad).toFixed(2),
        y: margin.top,
        width: Math.max(1, xPixel(maxLoad) - xPixel(minLoad)).toFixed(2),
        height: plotHeight,
        class: 'tyre-load-band'
      }));
    }

    var yTicks = [];
    for (var yValue = yMin; yValue <= yMax + yStep * 0.001; yValue += yStep) {
      yTicks.push(Number(yValue.toFixed(4)));
    }
    yTicks.forEach(function (tick) {
      var py = yPixel(tick);
      gridGroup.appendChild(createSvgElement('line', {
        x1: margin.left,
        y1: py.toFixed(2),
        x2: width - margin.right,
        y2: py.toFixed(2)
      }));
      axesGroup.appendChild(createSvgElement('text', {
        x: margin.left - 9,
        y: (py + 3.2).toFixed(2),
        'text-anchor': 'end'
      }, tick.toFixed(2)));
    });

    var xStep = niceStep((xMax - xMin) / 5);
    var xTicks = [];
    for (var xValue = Math.ceil(xMin / xStep) * xStep;
      xValue <= xMax + xStep * 0.001; xValue += xStep) {
      xTicks.push(Number(xValue.toFixed(4)));
    }
    xTicks.forEach(function (tick) {
      var px = xPixel(tick);
      gridGroup.appendChild(createSvgElement('line', {
        x1: px.toFixed(2),
        y1: margin.top,
        x2: px.toFixed(2),
        y2: height - margin.bottom
      }));
      axesGroup.appendChild(createSvgElement('text', {
        x: px.toFixed(2),
        y: height - margin.bottom + 17,
        'text-anchor': 'middle'
      }, (tick / 1000).toFixed(xStep >= 1000 ? 0 : 1)));
    });

    axesGroup.appendChild(createSvgElement('line', {
      x1: margin.left,
      y1: margin.top,
      x2: margin.left,
      y2: height - margin.bottom
    }));
    axesGroup.appendChild(createSvgElement('line', {
      x1: margin.left,
      y1: height - margin.bottom,
      x2: width - margin.right,
      y2: height - margin.bottom
    }));
    axesGroup.appendChild(createSvgElement('text', {
      x: margin.left,
      y: margin.top - 8,
      'text-anchor': 'start',
      class: 'tyre-axis-title'
    }, 'μ'));
    axesGroup.appendChild(createSvgElement('text', {
      x: margin.left + plotWidth / 2,
      y: height - 9,
      'text-anchor': 'middle',
      class: 'tyre-axis-title'
    }, 'TYRE LOAD Fz (kN)'));

    var frontPathData = '';
    var rearPathData = '';
    var sampleCount = 100;
    for (var i = 0; i <= sampleCount; i += 1) {
      var sampleLoad = xMin + ((xMax - xMin) * i) / sampleCount;
      var px = xPixel(sampleLoad);
      var frontPy = yPixel(muAtLoad(sampleLoad, 'front'));
      var rearPy = yPixel(muAtLoad(sampleLoad, 'rear'));
      frontPathData += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ' ' + frontPy.toFixed(2);
      rearPathData += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ' ' + rearPy.toFixed(2);
      if (i < sampleCount) {
        frontPathData += ' ';
        rearPathData += ' ';
      }
    }
    if (frontPath) {
      frontPath.setAttribute('d', frontPathData);
    }
    if (rearPath) {
      rearPath.setAttribute('d', rearPathData);
    }

    var labelPoints = [];
    samples.forEach(function (sample) {
      var definition = sample.definition;
      if (!(sample.load > 0)) {
        return;
      }

      var pointX = xPixel(sample.load);
      var pointY = yPixel(sample.mu);
      var marker = createSvgElement('circle', {
        cx: pointX.toFixed(2),
        cy: pointY.toFixed(2),
        r: 4.6,
        class: 'tyre-point-marker tyre-point-marker--' + definition.axle +
          ' is-' + sample.side
      });
      marker.appendChild(createSvgElement('title', null,
        definition.code + ' · Fz ' + (sample.load / 1000).toFixed(2) +
        ' kN · μ ' + sample.mu.toFixed(3)));
      pointsGroup.appendChild(marker);
      labelPoints.push({
        code: definition.code,
        axle: definition.axle,
        x: pointX,
        y: pointY
      });
    });

    var labelPlacements = layoutTyrePointLabels(
      labelPoints, width, height, margin
    );
    labelPoints.forEach(function (point, index) {
      var placement = labelPlacements[index];
      pointsGroup.appendChild(createSvgElement('text', {
        x: placement.x.toFixed(2),
        y: placement.y.toFixed(2),
        'text-anchor': placement.anchor,
        class: 'tyre-point-label tyre-point-label--' + point.axle
      }, point.code));
    });

    if (note) {
      if (currentTyreId === 'custom') {
        note.textContent = '自定义模式：前后轴共用 μ_ref / k；FZ0 沿用当前胶料。';
      } else {
        var compound = TYRE_COMPOUNDS[currentTyreId];
        var sameTyre =
          Math.abs(tyreState.tireMuRef - tyreState.tireRearMuRef) < 1e-9 &&
          Math.abs(tyreState.tireFz0N - tyreState.tireRearFz0N) < 1e-9 &&
          Math.abs(tyreState.tireLoadSensitivityK - tyreState.tireRearLoadSensitivityK) < 1e-9;
        note.textContent = (compound && compound.name
          ? 'AC ' + compound.name + ' 胶料 · '
          : '') +
          (sameTyre
            ? '前后轴参数相同，曲线重合。'
            : '前后轴参数不同，曲线分开。');
      }
    }

    var pointSummary = samples.map(function (sample) {
      if (!(sample.load > 0)) {
        return sample.definition.code + ' 离地';
      }
      return sample.definition.code + ' Fz ' + (sample.load / 1000).toFixed(2) +
        ' kN，μ ' + sample.mu.toFixed(3);
    }).join('；');
    svg.setAttribute('aria-label',
      currentTyreName() + ' 轮胎 μ–Fz 曲线；' + pointSummary + '。');
  }

  function renderTyreForceCurve(result) {
    var svg = $('tyreForceSvg');
    if (!svg) {
      return;
    }

    var gridGroup = $('tyreForceGrid');
    var axesGroup = $('tyreForceAxes');
    var pointsGroup = $('tyreForcePoints');
    var frontPath = $('tyreForceFrontLine');
    var rearPath = $('tyreForceRearLine');
    if (!gridGroup || !axesGroup || !pointsGroup) {
      return;
    }

    var width = 340;
    var height = 400;
    var margin = { left: 50, right: 12, top: 20, bottom: 42 };
    var plotWidth = width - margin.left - margin.right;
    var plotHeight = height - margin.top - margin.bottom;
    var tyreState = result.state;

    function muAtLoad(load, axle) {
      var muRef = axle === 'rear'
        ? tyreState.tireRearMuRef
        : tyreState.tireMuRef;
      var fz0N = axle === 'rear'
        ? tyreState.tireRearFz0N
        : tyreState.tireFz0N;
      var k = axle === 'rear'
        ? tyreState.tireRearLoadSensitivityK
        : tyreState.tireLoadSensitivityK;
      if (!(load > 0) || !(fz0N > 0)) {
        return 0;
      }
      return muRef * Math.pow(load / fz0N, -k);
    }

    function forceAtLoad(load, axle) {
      return muAtLoad(load, axle) * load / 1000;
    }

    var samples = TYRE_POINT_DEFS.map(function (definition) {
      var grip = result.wheelGrip[definition.code];
      var isLeftWheel = definition.code === 'FL' || definition.code === 'RL';
      var isOuter = result.outerSide !== 'none' &&
        ((result.outerSide === 'left' && isLeftWheel) ||
          (result.outerSide === 'right' && !isLeftWheel));
      return {
        definition: definition,
        load: grip.load,
        mu: grip.mu,
        capacity: grip.capacity,
        axle: definition.front ? 'front' : 'rear',
        side: isOuter ? 'outer' : 'inner'
      };
    });

    var positiveSamples = samples.filter(function (sample) {
      return sample.load > 0;
    });
    var loadValues = positiveSamples.map(function (sample) {
      return sample.load;
    });
    var minLoad = loadValues.length ? Math.min.apply(null, loadValues) : 1800;
    var maxLoad = loadValues.length ? Math.max.apply(null, loadValues) : 4700;
    var xMin = Math.max(400, Math.floor(minLoad * 0.82 / 100) * 100);
    var xMax = Math.ceil(Math.max(maxLoad * 1.12, xMin + 1800) / 500) * 500;

    var forceCandidates = [
      forceAtLoad(xMin, 'front'),
      forceAtLoad(xMax, 'front'),
      forceAtLoad(xMin, 'rear'),
      forceAtLoad(xMax, 'rear')
    ].concat(samples.map(function (sample) {
      return sample.capacity / 1000;
    }));
    var rawMax = Math.max.apply(null, forceCandidates.concat([0.5])) * 1.15;
    var yStep = niceStep(rawMax / 4);
    var yMax = Math.ceil(rawMax / yStep) * yStep;
    if (!(yMax > 0)) {
      yMax = yStep * 4;
    }

    function xPixel(load) {
      return margin.left + ((load - xMin) / (xMax - xMin)) * plotWidth;
    }

    function yPixel(force) {
      return margin.top + (1 - force / yMax) * plotHeight;
    }

    clearSvgGroup(gridGroup);
    clearSvgGroup(axesGroup);
    clearSvgGroup(pointsGroup);

    if (maxLoad > minLoad) {
      gridGroup.appendChild(createSvgElement('rect', {
        x: xPixel(minLoad).toFixed(2),
        y: margin.top,
        width: Math.max(1, xPixel(maxLoad) - xPixel(minLoad)).toFixed(2),
        height: plotHeight,
        class: 'tyre-load-band'
      }));
    }

    var yTicks = [];
    for (var yValue = 0; yValue <= yMax + yStep * 0.001; yValue += yStep) {
      yTicks.push(Number(yValue.toFixed(4)));
    }
    yTicks.forEach(function (tick) {
      var py = yPixel(tick);
      gridGroup.appendChild(createSvgElement('line', {
        x1: margin.left,
        y1: py.toFixed(2),
        x2: width - margin.right,
        y2: py.toFixed(2)
      }));
      axesGroup.appendChild(createSvgElement('text', {
        x: margin.left - 9,
        y: (py + 3.2).toFixed(2),
        'text-anchor': 'end'
      }, tick.toFixed(1)));
    });

    var xStep = niceStep((xMax - xMin) / 5);
    for (var xValue = Math.ceil(xMin / xStep) * xStep;
      xValue <= xMax + xStep * 0.001; xValue += xStep) {
      var px = xPixel(xValue);
      gridGroup.appendChild(createSvgElement('line', {
        x1: px.toFixed(2),
        y1: margin.top,
        x2: px.toFixed(2),
        y2: height - margin.bottom
      }));
      axesGroup.appendChild(createSvgElement('text', {
        x: px.toFixed(2),
        y: height - margin.bottom + 17,
        'text-anchor': 'middle'
      }, (xValue / 1000).toFixed(xStep >= 1000 ? 0 : 1)));
    }

    axesGroup.appendChild(createSvgElement('line', {
      x1: margin.left,
      y1: margin.top,
      x2: margin.left,
      y2: height - margin.bottom
    }));
    axesGroup.appendChild(createSvgElement('line', {
      x1: margin.left,
      y1: height - margin.bottom,
      x2: width - margin.right,
      y2: height - margin.bottom
    }));
    axesGroup.appendChild(createSvgElement('text', {
      x: margin.left,
      y: margin.top - 6,
      'text-anchor': 'start',
      class: 'tyre-axis-title'
    }, 'μ × Fz (kN)'));
    axesGroup.appendChild(createSvgElement('text', {
      x: margin.left + plotWidth / 2,
      y: height - 9,
      'text-anchor': 'middle',
      class: 'tyre-axis-title'
    }, 'TYRE LOAD Fz (kN)'));

    var frontPathData = '';
    var rearPathData = '';
    var sampleCount = 100;
    for (var i = 0; i <= sampleCount; i += 1) {
      var sampleLoad = xMin + ((xMax - xMin) * i) / sampleCount;
      var pxPath = xPixel(sampleLoad);
      var frontPy = yPixel(forceAtLoad(sampleLoad, 'front'));
      var rearPy = yPixel(forceAtLoad(sampleLoad, 'rear'));
      frontPathData += (i === 0 ? 'M' : 'L') +
        pxPath.toFixed(2) + ' ' + frontPy.toFixed(2);
      rearPathData += (i === 0 ? 'M' : 'L') +
        pxPath.toFixed(2) + ' ' + rearPy.toFixed(2);
      if (i < sampleCount) {
        frontPathData += ' ';
        rearPathData += ' ';
      }
    }
    if (frontPath) {
      frontPath.setAttribute('d', frontPathData);
    }
    if (rearPath) {
      rearPath.setAttribute('d', rearPathData);
    }

    var pointSummary = [];
    var labelPoints = [];
    samples.forEach(function (sample) {
      if (!(sample.load > 0)) {
        return;
      }
      var definition = sample.definition;
      var pointX = xPixel(sample.load);
      var pointY = yPixel(sample.capacity / 1000);
      var marker = createSvgElement('circle', {
        cx: pointX.toFixed(2),
        cy: pointY.toFixed(2),
        r: 4.6,
        class: 'tyre-point-marker tyre-point-marker--' + definition.axle +
          ' is-' + sample.side
      });
      marker.appendChild(createSvgElement('title', null,
        definition.code + ' · Fz ' + (sample.load / 1000).toFixed(2) +
        ' kN · μ ' + sample.mu.toFixed(3) +
        ' · μ × Fz ' + (sample.capacity / 1000).toFixed(2) + ' kN'));
      pointsGroup.appendChild(marker);
      labelPoints.push({
        code: definition.code,
        axle: definition.axle,
        x: pointX,
        y: pointY
      });
      pointSummary.push(definition.code + ' ' +
        (sample.capacity / 1000).toFixed(2) + ' kN');
    });

    var labelPlacements = layoutTyrePointLabels(
      labelPoints, width, height, margin
    );
    labelPoints.forEach(function (point, index) {
      var placement = labelPlacements[index];
      pointsGroup.appendChild(createSvgElement('text', {
        x: placement.x.toFixed(2),
        y: placement.y.toFixed(2),
        'text-anchor': placement.anchor,
        class: 'tyre-point-label tyre-point-label--' + point.axle
      }, point.code));
    });

    svg.setAttribute('aria-label',
      '前轴与后轴轮胎 μ×Fz 抓地力随垂向载荷变化；当前 ' +
      pointSummary.join('，') + '。');
  }

  function updatePresetActive() {
    var buttons = document.querySelectorAll('[data-preset]');
    buttons.forEach(function (button) {
      var preset = PRESETS[button.getAttribute('data-preset')];
      if (!preset) {
        return;
      }
      var matches = Object.keys(preset).every(function (key) {
        return Math.abs(state[key] - preset[key]) < 0.05;
      });
      button.classList.toggle('is-active', matches);
    });
  }

  function render() {
    var result = model.calculate(state);

    updateConditionAndSetup(result);
    updateLongitudinalUi();
    updateGPad(result);
    updateBalance(result);
    updateCards(result);
    updateWheelLabels(result);
    updatePresetActive();
    renderTyreCurve(result);
    renderTyreForceCurve(result);

    if (scene) {
      scene.setModel(result);
    }

    syncControls();
    syncTyreUi();
    updateSourcePanel();
  }

  function applyStatePatch(patch, options) {
    var opts = options || {};
    Object.keys(patch).forEach(function (key) {
      state[key] = patch[key];
    });
    markGRegionsDirty();
    if (opts.clearAuto !== false) {
      clearAutoNote();
    }
    syncControls();
    render();
  }

  function handleParameterInput(element, isCommit) {
    var key = element.getAttribute('data-param');
    if (!key) {
      return;
    }
    var value = Number(element.value);
    if (!Number.isFinite(value)) {
      return;
    }

    var min = element.min !== '' ? Number(element.min) : model.LIMITS[key][0];
    var max = element.max !== '' ? Number(element.max) : model.LIMITS[key][1];
    if (!isCommit && (value < min || value > max)) {
      return;
    }
    value = clamp(value, min, max);

    state[key] = value;
    if (key === 'tireMuRef') {
      state.tireRearMuRef = value;
    } else if (key === 'tireLoadSensitivityK') {
      state.tireRearLoadSensitivityK = value;
    }
    markGRegionsDirty();
    clearAutoNote();
    syncControls();
    render();
  }

  function bindControls() {
    bindGPad();

    parameterElements.forEach(function (element) {
      var isRange = element.type === 'range';
      element.addEventListener(isRange ? 'input' : 'input', function () {
        handleParameterInput(element, false);
      });
      if (!isRange) {
        element.addEventListener('change', function () {
          handleParameterInput(element, true);
        });
        element.addEventListener('blur', function () {
          handleParameterInput(element, true);
        });
      }
      if (isRange) {
        updateRangeFill(element);
      }
    });

    var frontWeightInput = $('frontWeightPct');
    if (frontWeightInput) {
      function applyFrontWeight(isCommit) {
        var pct = Number(frontWeightInput.value);
        if (!Number.isFinite(pct)) {
          return;
        }
        if (!isCommit && (pct < 30 || pct > 70)) {
          return;
        }
        pct = clamp(pct, 30, 70);
        state.frontWeight = pct / 100;
        markGRegionsDirty();
        clearAutoNote();
        syncControls();
        render();
      }
      frontWeightInput.addEventListener('input', function () { applyFrontWeight(false); });
      frontWeightInput.addEventListener('change', function () { applyFrontWeight(true); });
      frontWeightInput.addEventListener('blur', function () { applyFrontWeight(true); });
    }

    var carSelect = $('carSelect');
    if (carSelect) {
      carSelect.addEventListener('change', function () {
        if (carSelect.value !== currentCarId) {
          loadCar(carSelect.value);
        }
      });
    }

    var driveSelect = $('driveTypeSelect');
    if (driveSelect) {
      driveSelect.addEventListener('change', function () {
        var nextType = driveSelect.value;
        if (!model.DRIVE_MODES[nextType]) {
          return;
        }
        state.driveType = nextType;
        markGRegionsDirty();
        clearAutoNote();
        syncControls();
        render();
      });
    }

    var tyreSelect = $('tyreCompoundSelect');
    if (tyreSelect) {
      tyreSelect.addEventListener('change', function () {
        currentTyreId = tyreSelect.value;
        var compound = TYRE_COMPOUNDS[currentTyreId];
        if (compound) {
          applyCompoundToState(compound);
        } else if (currentTyreId === 'custom') {
          // Custom μ_ref/k are shared by both axles; preserve per-axle FZ0,
          // width, radius and vertical rate from the previous AC compound.
          state.tireRearMuRef = state.tireMuRef;
          state.tireRearLoadSensitivityK = state.tireLoadSensitivityK;
        }
        markGRegionsDirty();
        clearAutoNote();
        syncTyreUi();
        render();
      });
    }

    document.querySelectorAll('[data-preset]').forEach(function (button) {
      button.addEventListener('click', function () {
        var preset = PRESETS[button.getAttribute('data-preset')];
        if (!preset) {
          return;
        }
        clearAutoNote();
        applyStatePatch(preset);
      });
    });

    var autoButton = $('autoBalanceButton');
    if (autoButton) {
      autoButton.addEventListener('click', function () {
        var solution = model.solveNeutralFrontArb(state);
        state.arbFrontNmm = solution.value;
        markGRegionsDirty();
        syncControls();
        render();

        var note = $('autoBalanceNote');
        if (note) {
          if (solution.achieved) {
            note.textContent = '已调前 ARB → ' + solution.value.toFixed(1) +
              ' N/mm · 残余 ' + formatSigned(solution.deltaPP, 1) + ' pp';
          } else {
            note.textContent = '当前范围无法完全配平；前 ARB 取边界 ' +
              solution.value.toFixed(1) + ' N/mm · 残余 ' + formatSigned(solution.deltaPP, 1) + ' pp';
          }
        }

        if (autoNoteTimer) {
          window.clearTimeout(autoNoteTimer);
        }
        autoNoteTimer = window.setTimeout(function () {
          var noteElement = $('autoBalanceNote');
          if (noteElement) {
            noteElement.textContent = '';
          }
        }, 9000);
      });
    }

    var resetAllButton = $('resetAllButton');
    if (resetAllButton) {
      resetAllButton.addEventListener('click', function () {
        stopGPlayback(false);
        clearGTrail();
        clearAutoNote();
        state = model.createBaseState(currentCarId);
        currentTyreId = currentCar.defaultCompoundId;
        lastSourceSignature = '';
        markGRegionsDirty();
        populateTyreOptions();
        updateCarUi();
        syncControls();
        syncTyreUi();
        render();
      });
    }

    var resetViewButton = $('resetViewButton');
    if (resetViewButton) {
      resetViewButton.addEventListener('click', function () {
        if (scene && typeof scene.resetView === 'function') {
          scene.resetView();
        }
      });
    }
  }

  function showSceneError(code, message) {
    var loading = $('sceneLoading');
    var error = $('sceneError');
    var codeElement = error ? error.querySelector('.scene-error-code') : null;
    if (loading) {
      loading.classList.add('is-hidden');
    }
    if (error) {
      error.hidden = false;
    }
    if (codeElement) {
      codeElement.textContent = code;
    }
    if (message) {
      var paragraph = error ? error.querySelector('p') : null;
      if (paragraph) {
        paragraph.textContent = message;
      }
    }
    var wheelLabels = document.querySelector('.scene-wheel-labels');
    if (wheelLabels) {
      wheelLabels.style.display = 'none';
    }
  }

  function initScene() {
    if (!window.THREE) {
      showSceneError('THREE.JS MISSING', '本地 Three.js 文件未加载，3D 底盘无法启动；数值模拟仍可使用。');
      return;
    }
    if (!window.CorneringChassisScene) {
      showSceneError('3D MODULE MISSING', '3D 场景模块未加载，数值模拟仍可使用。');
      return;
    }

    try {
      scene = new window.CorneringChassisScene($('sceneContainer'), {
        onReady: function () {
          render();
        }
      });
      if (typeof scene.setCar === 'function') {
        scene.setCar(currentCar);
      }
      scene.setModel(model.calculate(state));
    } catch (error) {
      scene = null;
      showSceneError('WEBGL UNAVAILABLE', '请启用浏览器硬件加速或使用支持 WebGL 的浏览器；数值模拟仍可使用。');
    }
  }

  function init() {
    buildGaugeTicks();
    buildGPad();
    buildGRegions();
    refreshGRegions();
    if (!gRegionTimer) {
      gRegionTimer = window.setInterval(
        refreshGRegionsIfNeeded,
        G_REGION_INTERVAL_MS
      );
    }
    populateCarOptions();
    populateTyreOptions();
    updateCarUi();
    syncControls();
    bindControls();
    render();
    initScene();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', function () {
    if (gRegionTimer) {
      window.clearInterval(gRegionTimer);
      gRegionTimer = null;
    }
    if (gPlayFrame) {
      window.cancelAnimationFrame(gPlayFrame);
      gPlayFrame = null;
    }
    if (scene && typeof scene.dispose === 'function') {
      scene.dispose();
    }
  });
})();
