# GT86 Cornering Lab

一个面向数据说明与调校直觉的 **GT86 / ZN6 3D 底盘 · 前后轴抓地平衡实验台**。

打开 [`index.html`](./index.html) 即可运行。页面无网络请求、无 CDN，Three.js 已本地化到 `vendor/`。

![桌面预览](docs/preview-desktop.png)

在线版本：[hanlin-yu.github.io/gt86-cornering-lab](https://hanlin-yu.github.io/gt86-cornering-lab/)

## 功能

- 可旋转 / 缩放的 3D 底盘：前麦弗逊、后双叉臂、四组弹簧-减振器、前后防倾杆、下控制臂、上横臂、转向拉杆、轮毂与轮胎。
- 3D **CoG 质心标签 + 垂线 / 地面投影**，以及随侧向加速度缩放的白色 **G 力箭头**。
- 前后弹簧率可在 **8–200 N/mm** 范围内调节；ARB 保持 0–80 / 0–60 N/mm。
- 每个车轮的 3D 标签直接显示当前轮荷以及相对静态轮荷的变化百分比，例如 `FL 内侧 2.54 kN (−29.8%)`；外轮为正、内轮为负。
- 轴载荷转移同时在轴卡片与解释文本中显示为 **ΔFz / 该轴总垂直载荷（Fz）**。
- 实时联动：改变弹簧率、ARB 刚度或侧向加速度时，底盘侧倾、车轮垂向载荷、悬架杆件端点、弹簧长度、ARB 摆臂、轮心高度、CoG、G 箭头和载荷转移百分比都会更新。
- 前后轴总抓地力、需求量、利用率、前后轴载荷转移、左右轮载荷。
- 轴总抓地力之和与需求；内侧轮离地 / 总抓地力不足警告。
- 调校预设：GT86 原厂、前轴加硬、后轴加硬、自动配平（求前 ARB 使前后利用率相等）。
- 可编辑高级参数：整车质量、前轴荷、质心高度、轮胎基准 μ、等效载荷转移抓地损失。

## 数据来源

从 Assetto Corsa 安装目录只读解包：

```text
<Assetto Corsa install>\content\cars\ks_toyota_gt86\data.acd
```

原始游戏文件没有被修改。参与建模的数值：

| 项目 | 值 | 来源 |
| --- | --- | --- |
| 质量 | 1285 kg（含车手，无燃油） | `car.ini [BASIC] TOTALMASS` |
| 轴距 | 2.570 m | `suspensions.ini [BASIC] WHEELBASE` |
| 前轴荷 | 57.5% | `suspensions.ini [BASIC] CG_LOCATION` |
| 前 / 后轮距 | 1.520 / 1.540 m | `suspensions.ini [FRONT]/[REAR] TRACK` |
| 质心高度 | ≈0.423 m | `tyres.ini RADIUS 0.3126 − BASEY (−0.110)` |
| 前 / 后弹簧轮端刚度 | 23.0 / 18.0 N/mm | `SPRING_RATE 23000 / 18000 N/m` |
| 前 / 后 ARB 等效轮端刚度 | 39.0 / 5.0 N/mm | `[ARB] FRONT=39000 / REAR=5000`，按 AC/CSP 轮端 N/m 约定 |
| 默认轮胎 | Semislicks | `tyres.ini [COMPOUND_DEFAULT] INDEX=2` |
| 轮胎参考载荷 / 摩擦 / 载荷敏感 | FZ0 2494 N, DY_REF 1.28, LS_EXPY 0.8119 | `tyres.ini [FRONT_2]/[REAR_2]` |
| 轮胎垂向刚度 | 262593 N/m | 用于 3D 中轮胎压缩的视觉化 |

ARB 的原始文件注释与 CSP 文档对单位表述存在差异；本项目把 `[ARB]` 值当作轮端等效刚度处理，页面中也明确标注了模型边界。

## 模型

```text
Kφ axle   = (k_spring + k_ARB) · t² / 2
s_f       = Kφ,F / (Kφ,F + Kφ,R)
ΔFz       = s_f · m · a_y · h / t
Fgrip,axle = μ · Fz_axle − k · |ΔFz|
U          = F_demand / Fgrip
ΔFz%       = ΔFz / Fz_axle
```

- 悬架弹簧与 ARB 首先合并成轴轮端刚度，再给出前后侧倾刚度分配。
- 前 / 后轴需求侧向力按轴荷分配；`ΔFz%` 的分母是该轴的总垂直载荷，而不是整车总载荷。
- 利用率高的一轴先达到抓地极限：前轴高 → understeer；后轴高 → oversteer。
- **载荷转移损失系数 k 默认为 0.30，是可调工程等效系数，不是 AC 逐点 Pacejka 轮胎曲线的直接参数。** `k` 设为 0 时，改变弹簧/ARB 分配不会改变轴总抓地力；这是模型的一个可验证性质。
- 3D 悬架是依据 GT86 的 STRUT / DWB 架构、轴距、轮距和刚度做的**简化机构示意**，不是对 `suspensions.ini` 硬点的逐点复刻。

## 运行与测试

直接双击 `index.html`，或在本目录运行：

```powershell
Start-Process ".\index.html"
```

物理模型断言：

```powershell
node tests/model.test.js
```

当前覆盖：默认 GT86 载荷、左右轮载荷和、前后刚度对抓地力的方向性、`k=0` 时无平衡效应、自动配平收敛、轮荷截断与离地警告、总抓地力超限、轮距对侧倾刚度的影响、参考转弯半径、弹簧率 200 N/mm 上限。

## 文件

```text
index.html            页面结构
styles.css            仪表台与响应式样式
model.js              纯函数稳态模型（UMD，可在 Node 测试）
app.js                UI、图表、预设、自动配平
scene3d.js            Three.js 3D 底盘、悬架、弹簧、ARB、相机控制
tests/model.test.js   模型测试
vendor/three.min.js   Three.js r149（MIT）
vendor/THREE-LICENSE.txt
docs/                 验收截图
```

## 边界

这是用于解释和参数探索的**稳态纯侧向机构模型**，不是 AC 物理引擎复刻或圈速模拟器。未包含：空气动力学、差速器锁止、侧倾中心/几何载荷转移、轮胎温度/压力、Camber/Toe、非线性和瞬态响应。所有结果用于比较趋势。

外部参考：[CSP suspension docs](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Cars-%E2%80%93-Suspension)、[OptimumG springs & dampers](https://optimumg.com/wp-content/uploads/2020/01/SpringsDampers_Tech_Tip_2.pdf)、[Three.js](https://threejs.org/)。
