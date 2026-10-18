(function () {
  'use strict';

  var model = window.CorneringModel;
  if (!model) {
    return;
  }

  var state = model.cloneBaseState();
  var scene = null;
  var autoNoteTimer = null;

  var PRESETS = {
    stock: {
      springFrontNmm: 23,
      springRearNmm: 18,
      arbFrontNmm: 39,
      arbRearNmm: 5
    },
    front: {
      springFrontNmm: 30,
      springRearNmm: 18,
      arbFrontNmm: 60,
      arbRearNmm: 5
    },
    rear: {
      springFrontNmm: 23,
      springRearNmm: 24,
      arbFrontNmm: 39,
      arbRearNmm: 40
    }
  };

  var COPY = {
    understeer: {
      cn: '推头',
      en: 'UNDERSTEER',
      kicker: 'FRONT AXLE SATURATES FIRST',
      sub: '前轴利用率更高，前轮先失去侧向余量。',
      hint: '往中性：软化前轴弹簧 / ARB，或增加后轴侧倾刚度。'
    },
    oversteer: {
      cn: '甩尾',
      en: 'OVERSTEER',
      kicker: 'REAR AXLE SATURATES FIRST',
      sub: '后轴利用率更高，后轮先失去侧向余量。',
      hint: '往中性：软化后轴弹簧 / ARB，或增加前轴侧倾刚度。'
    },
    neutral: {
      cn: '中性',
      en: 'NEUTRAL',
      kicker: 'AXLES REACH THE LIMIT TOGETHER',
      sub: '前后轴利用率几乎相同，接近同时达到极限。',
      hint: '前后轴利用率差位于 ±0.35 pp 中性带内。'
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
    if (Math.abs(value) < 0.05) {
      return '0.0';
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
      FL: result.wheelLoads.frontInner,
      FR: result.wheelLoads.frontOuter,
      RL: result.wheelLoads.rearInner,
      RR: result.wheelLoads.rearOuter
    };
    var staticMap = {
      FL: result.staticLoads.frontWheel,
      FR: result.staticLoads.frontWheel,
      RL: result.staticLoads.rearWheel,
      RR: result.staticLoads.rearWheel
    };

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

      var label = document.querySelector('[data-wheel-label="' + wheelId + '"]');
      if (label) {
        var lifted = wheelId === 'FL' ? result.wheelLift.front :
          wheelId === 'RL' ? result.wheelLift.rear : false;
        label.classList.toggle('is-lifted', lifted);
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
      element.innerHTML =
        '前轴侧倾刚度占比 <strong>' + frontShare + '%</strong>，前轴产生 <strong>' +
        formatForce(result.frontLoadTransfer) + ' kN（' + frontTransferPct + '% Fz）</strong> 的左右载荷转移，' +
        '轴总抓地力被压到 <strong>' + formatForce(result.grip.front) + ' kN</strong>。' +
        '前轴利用率高出后轴 <strong>' + delta + ' pp</strong>，前轮先到极限。';
    } else if (result.balance === 'oversteer') {
      element.innerHTML =
        '后轴侧倾刚度占比 <strong>' + rearShare + '%</strong>，后轴产生 <strong>' +
        formatForce(result.rearLoadTransfer) + ' kN（' + rearTransferPct + '% Fz）</strong> 的左右载荷转移，' +
        '轴总抓地力被压到 <strong>' + formatForce(result.grip.rear) + ' kN</strong>。' +
        '后轴利用率高出前轴 <strong>' + delta + ' pp</strong>，后轮先到极限。';
    } else {
      element.innerHTML =
        '前后轴利用率差仅 <strong>' + delta + ' pp</strong>，两轴接近同时达到极限。' +
        '当前侧倾刚度分配为前 <strong>' + frontShare + '%</strong> / 后 <strong>' + rearShare + '%</strong>。';
    }
  }

  function updateCards(result) {
    setText('frontGripValue', formatForce(result.grip.front));
    setText('rearGripValue', formatForce(result.grip.rear));
    setText('frontDemandValue', formatForce(result.demand.front));
    setText('rearDemandValue', formatForce(result.demand.rear));

    setText('frontUtilCardValue', formatPercent(result.utilisation.front));
    setText('rearUtilCardValue', formatPercent(result.utilisation.rear));

    setBarWidth($('frontUtilBarCard'), result.utilisation.front);
    setBarWidth($('rearUtilBarCard'), result.utilisation.rear);

    var frontReserve = result.margin.front;
    var rearReserve = result.margin.rear;
    var frontReserveElement = $('frontReserveValue');
    var rearReserveElement = $('rearReserveValue');

    if (frontReserveElement) {
      frontReserveElement.textContent = (frontReserve >= 0 ? '+' : '−') +
        Math.abs(frontReserve / 1000).toFixed(2) + ' kN ' + (frontReserve >= 0 ? '余量' : '超限');
      frontReserveElement.classList.toggle('is-over', frontReserve < 0);
    }
    if (rearReserveElement) {
      rearReserveElement.textContent = (rearReserve >= 0 ? '+' : '−') +
        Math.abs(rearReserve / 1000).toFixed(2) + ' kN ' + (rearReserve >= 0 ? '余量' : '超限');
      rearReserveElement.classList.toggle('is-over', rearReserve < 0);
    }

    var frontTransferPct = (result.loadTransferRatio.front * 100).toFixed(1);
    var rearTransferPct = (result.loadTransferRatio.rear * 100).toFixed(1);
    setText('frontTransferPct', frontTransferPct);
    setText('rearTransferPct', rearTransferPct);
    setText('frontTransferAbs', ' · ' + formatForce(result.frontLoadTransfer) + ' kN');
    setText('rearTransferAbs', ' · ' + formatForce(result.rearLoadTransfer) + ' kN');
    setText('frontRollShareValue', (result.rollStiffness.frontShare * 100).toFixed(1));
    setText('rearRollShareValue', (result.rollStiffness.rearShare * 100).toFixed(1));
    setText('frontWheelLoadsValue',
      formatForce(result.wheelLoads.frontOuter) + ' / ' + formatForce(result.wheelLoads.frontInner));
    setText('rearWheelLoadsValue',
      formatForce(result.wheelLoads.rearOuter) + ' / ' + formatForce(result.wheelLoads.rearInner));
    setText('frontWheelRateValue', (result.springRates.frontNmm).toFixed(1));
    setText('rearWheelRateValue', (result.springRates.rearNmm).toFixed(1));

    toggleClass($('frontUtilCardValue'), 'is-over', result.utilisation.front >= 1);
    toggleClass($('rearUtilCardValue'), 'is-over', result.utilisation.rear >= 1);
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

    var needleAngle = -clamp(result.deltaPP / 8, -1, 1) * 70;
    var needleGroup = $('needleGroup');
    if (needleGroup) {
      needleGroup.style.transform = 'rotate(' + needleAngle.toFixed(2) + 'deg)';
    }

    var gauge = $('balanceGauge');
    if (gauge) {
      gauge.setAttribute('aria-label',
        '转向平衡仪表：' + copy.cn + '，前轴减后轴利用率差 ' + formatSigned(result.deltaPP, 1) + ' 个百分点。');
    }

    setBarWidth($('frontUtilBar'), result.utilisation.front);
    setBarWidth($('rearUtilBar'), result.utilisation.rear);
    setText('frontUtilValue', formatPercent(result.utilisation.front));
    setText('rearUtilValue', formatPercent(result.utilisation.rear));
    toggleClass($('frontUtilValue'), 'is-over', result.utilisation.front >= 1);
    toggleClass($('rearUtilValue'), 'is-over', result.utilisation.rear >= 1);

    setText('totalGripValue', formatForce(result.grip.total));
    setText('totalDemandValue', formatForce(result.demand.total));
    setBarWidth($('totalGripBar'), result.utilisation.total);

    var headroom = $('totalHeadroomValue');
    if (headroom) {
      headroom.textContent = (result.margin.total >= 0 ? '余量 +' : '超限 −') +
        Math.abs(result.margin.total / 1000).toFixed(2) + ' kN';
      headroom.classList.toggle('is-over', result.margin.total < 0);
    }

    updateExplanation(result);
    updateWarnings(result);
  }

  function updateConditionAndSetup(result) {
    setText('ayValue', result.state.lateralG.toFixed(2));
    setText('radiusValue', Math.round(result.cornerRadiusM) + ' m');
    setText('sceneAyValue', result.state.lateralG.toFixed(2));
    setText('sceneRadiusValue', String(Math.round(result.cornerRadiusM)));
    setText('sceneRollValue', result.rollAngleDeg.toFixed(2));
    setText('sceneFrontShareValue', (result.rollStiffness.frontShare * 100).toFixed(1));
    setText('cogHeightValue', result.state.cgHeightM.toFixed(3));
    setText('gVectorValue', result.state.lateralG.toFixed(2));
    setText('mobileCogHeight', result.state.cgHeightM.toFixed(3));
    setText('mobileGValue', result.state.lateralG.toFixed(2));

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
    updateBalance(result);
    updateCards(result);
    updateWheelLabels(result);
    updatePresetActive();

    if (scene) {
      scene.setModel(result);
    }

    syncControls();
  }

  function applyStatePatch(patch, options) {
    var opts = options || {};
    Object.keys(patch).forEach(function (key) {
      state[key] = patch[key];
    });
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
    clearAutoNote();
    syncControls();
    render();
  }

  function bindControls() {
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
        if (!isCommit && (pct < 40 || pct > 66)) {
          return;
        }
        pct = clamp(pct, 40, 66);
        state.frontWeight = pct / 100;
        clearAutoNote();
        syncControls();
        render();
      }
      frontWeightInput.addEventListener('input', function () { applyFrontWeight(false); });
      frontWeightInput.addEventListener('change', function () { applyFrontWeight(true); });
      frontWeightInput.addEventListener('blur', function () { applyFrontWeight(true); });
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
        clearAutoNote();
        state = model.cloneBaseState();
        syncControls();
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
      scene.setModel(model.calculate(state));
    } catch (error) {
      scene = null;
      showSceneError('WEBGL UNAVAILABLE', '请启用浏览器硬件加速或使用支持 WebGL 的浏览器；数值模拟仍可使用。');
    }
  }

  function init() {
    buildGaugeTicks();
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
    if (scene && typeof scene.dispose === 'function') {
      scene.dispose();
    }
  });
})();
