# Cornering Lab

一个面向数据说明与调校直觉的 **Assetto Corsa 多车型 3D 底盘 · 二维 G-G 抓地平衡实验台**。

打开 [`index.html`](./index.html) 即可运行。页面无网络请求、无 CDN，Three.js 已本地化到 `vendor/`。

![桌面预览](docs/preview-desktop.png)

在线版本：[hanlin-yu.github.io/gt86-cornering-lab](https://hanlin-yu.github.io/gt86-cornering-lab/)

当前可切换车型：

| 车型 | 驱动 | 数据目录 |
| --- | --- | --- |
| Toyota GT86 / ZN6 | RWD | `ks_toyota_gt86` |
| Mazda MX-5 ND | RWD | `ks_mazda_mx5_nd` |
| Mazda MX-5 Cup | RWD | `ks_mazda_mx5_cup` |
| Subaru Impreza 22B STi | AWD | `ddm_subaru_22b` |

## 功能

- **车型选择栏**：切换车辆时，质量、轴距、前轴荷、轮距、质心高度、弹簧/ARB、制动分配、驱动形式、默认轮胎和可选胶料全部按该车 `data.acd` 更新。
- **二维 G-G 输入**：横轴为侧向 G（左 / 右），纵轴为纵向 G（加速 / 制动），显示范围 **±2 g**；支持鼠标、触摸、方向键，轨迹保留最近 220 个点。
- **预计算推头 / 甩尾区域**：在 G-G 面板上用 **0.1 g 网格**预计算当前底盘设置下的推头区、甩尾区和超限区。区域最多每 **1 秒**在后台刷新一次（仅在调校参数变化时重算），不随光标或回放每帧重算，以节省 CPU。
- **入弯 → 弯心 → 出弯回放**：6.2 秒自动扫过从制动入弯、trail braking 到加速出弯的连续 G 组合；状态、载荷、轴抓地力、3D 底盘、弹簧、ARB、μ–Fz 曲线同步刷新。
- 可旋转 / 缩放的 3D 底盘：前麦弗逊、后双叉臂、四组弹簧-减振器、前后防倾杆、下控制臂、上横臂、转向拉杆、轮毂与轮胎。**3D 轴距 / 轮距会按所选车型缩放**；悬架架构和硬点仍是通用简化示意。
- 3D **CoG 质心标签 + 垂线 / 地面投影**；G 力箭头长度由合成 G 决定，方向表示惯性力（指向弯外侧，加速指向后方）。
- 每个车轮的 3D 标签显示当前轮荷与相对静态轮荷的变化百分比；外轮为正、内轮为负。纵向 G 会同时改变前后轴的两个轮荷。
- 前后弹簧率可在 **8–200 N/mm** 范围内调节；ARB 保持 0–80 / 0–60 N/mm。预设和自动配平会基于当前车型的原始轮端刚度生成。
- **制动平衡与驱动形式**：默认取所选车型 `brakes.ini` 的前轴占比和 `drivetrain.ini` 的驱动形式；页内可调前轴制动占比（30–90%），并可切换 RWD / FWD / AWD（AWD 采用 50/50 近似）。
- **AC 轮胎选择**：每款车只列出该车 `tyres.ini` 中真正存在的胶料；另有自定义模式可编辑 **μ_ref / k**（FZ0 继承上一次 AC 胶料）。
- **μ–Fz 曲线面板**：显示当前所选框的前 / 后轴 μ(Fz) 曲线、四个车轮所在的实际轮荷点，以及每点的 Fz / μ。同车前后轮胎参数相同时两条曲线重合；WIDTH 不进入该载荷敏感幂律。
- 轴卡显示总抓地力、合成需求（侧向 + 纵向）、联合利用率、侧向载荷转移、外 / 内轮载荷、簧 + 杆轮端刚度、Fx / Fy 分解。
- 内侧轮离地、轴荷卸载、总抓地力不足、单轴极限、低载荷敏感度等警告。
- **模型范围说明**：仅模拟底盘重心 / 载荷转移与载荷敏感 μ(Fz)；忽略轮胎滑移角、滑移率对 μ 的影响。

## 数据来源

从 Assetto Corsa 安装目录只读解包各车的 `data.acd`：

```text
<AC install>/content/cars/<car folder>/data.acd
```

原始游戏文件没有被修改。各车关键数据：

| 项目 | GT86 | MX-5 ND | MX-5 Cup | 22B STi |
| --- | --- | --- | --- | --- |
| 质量（含车手，无燃油） | 1285 kg | 1133 kg | 983 kg | 1297 kg |
| 轴距 | 2.570 m | 2.310 m | 2.310 m | 2.520 m |
| 前轴荷 | 57.5% | 53.0% | 54.0% | 63.0% |
| 前 / 后轮距 | 1.520 / 1.540 m | 1.496 / 1.503 m | 1.525 / 1.510 m | 1.480 / 1.500 m |
| 质心高度（估算） | 0.423 m | 0.458 m | 0.455 m | 0.496 m |
| 弹簧轮端刚度 F / R | 23.0 / 18.0 N/mm | 11.7 / 13.4 N/mm | 51.0 / 77.0 N/mm | 35.6 / 32.8 N/mm |
| ARB 等效轮端刚度 F / R | 39.0 / 5.0 N/mm | 19.0 / 4.8 N/mm | 39.0 / 4.8 N/mm | 18.0 / 16.2 N/mm |
| 制动前 / 后分配 | 72 / 28% | 72 / 28% | 75 / 25% | 78 / 22% |
| 驱动形式 | RWD | RWD | RWD | AWD |
| 悬挂 F / R | STRUT / DWB | DWB / DWB | DWB / DWB | STRUT / STRUT |
| 默认轮胎 | Semislicks | Semislicks | Slicks | Semislicks |

数据来源：

- 质量、轴距、前轴荷、轮距、弹簧率、ARB、`BASEY`：`car.ini` / `suspensions.ini`。
- 制动分配、驾驶舱可调性：`brakes.ini [DATA] FRONT_SHARE / COCKPIT_ADJUSTABLE`。
- 驱动形式：`drivetrain.ini [TRACTION] TYPE`。
- 轮胎参数：`tyres.ini` 各 `[FRONT*] / [REAR*]` 段。

质心高度按 `RADIUS − BASEY（前后按轴荷加权）` 估算；四车前后轮胎同宽同参数。ARB 的 AC 原文件注释与 CSP 文档在单位表述上存在差异；本项目把 `[ARB]` 值当作轮端等效刚度处理。

### 轮胎胶料

四款车的 `tyres.ini` 均未提供 `DY_CURVE`，因此统一使用 AC 的载荷敏感幂律。各胶料数据（前后相同）：

| 车型 | 胶料 | 宽度 | 半径 | 垂向 RATE | FZ0 | DY_REF | LS_EXPY | k = 1 − LS_EXPY |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GT86 | ECO | 215 mm | 0.3126 m | 263372 N/m | 2274 N | 1.215 | 0.7227 | 0.2773 |
| GT86 | Street | 215 mm | 0.3126 m | 263372 N/m | 2274 N | 1.23 | 0.8227 | 0.1773 |
| GT86 | Semislicks（默认） | 215 mm | 0.3126 m | 262593 N/m | 2494 N | 1.28 | 0.8119 | 0.1881 |
| MX-5 ND | Street | 205 mm | 0.30815 m | 233568 N/m | 2517 N | 1.23 | 0.8243 | 0.1757 |
| MX-5 ND | Semislicks（默认） | 205 mm | 0.30815 m | 228695 N/m | 2737 N | 1.28 | 0.8135 | 0.1865 |
| MX-5 Cup | Slicks（默认） | 215 mm | 0.305 m | 202410 N/m | 3045 N | 1.46 | 0.7094 | 0.2906 |
| 22B | Street | 235 mm | 0.310 m | 263038 N/m | 2590 N | 1.23 | 0.8341 | 0.1659 |
| 22B | Semislicks（默认） | 235 mm | 0.310 m | 277119 N/m | 2860 N | 1.28 | 0.84 | 0.16 |

轮胎垂向 RATE 仅用于 3D 轮胎压缩视觉；WIDTH 不进入 μ(Fz) 载荷敏感幂律。

## 模型

```text
正 lateralG = 右转；负 lateralG = 左转；载荷转移取 |a_y|
Kφ,axle    = (k_spring + k_ARB) · t² / 2
share_F    = Kφ,F / (Kφ,F + Kφ,R)
ΔFz_lat,F  = share_F · m · |a_y| · h / t_F
ΔFz_long   = m · a_x · h / L
Fz_F       = Fz_F,static − ΔFz_long
Fz_R       = Fz_R,static + ΔFz_long

k          = 1 − LS_EXPY
μ(Fz)      = μ_ref · (Fz / FZ0)^(−k)
Fy,max     = μ(Fz) · Fz
Fgrip,axle = Σ Fy,max

brake_F    = 当前车型 brakes.ini FRONT_SHARE（页内可调）
drive_F / drive_R = RWD 0 / 100 · FWD 100 / 0 · AWD 50 / 50
Fx,front / Fx,rear = 制动 m·a_x · brakeF / (1−brakeF)；
                     加速 m·a_x · drive_F / drive_R
F_res,axle = √(Fy,demand² + Fx,demand²)
U          = F_res,axle / Fgrip,axle
ΔFz%       = ΔFz_lat / Fz_axle
```

- 悬架弹簧与 ARB 首先合并成轴轮端刚度，再给出前后侧倾刚度分配。侧向载荷转移只由侧倾刚度分配决定。
- 纵向 G 通过质心高度与轴距在前后轴间转移垂直载荷；每个车轮的 μ 按其实际 Fz 查曲线。
- 前 / 后轴总抓地力是该轴两只轮胎的 `Fy,max` 之和。
- 合成需求包含侧向需求和纵向需求；利用率高的一轴先达到联合极限：前轴高 → understeer；后轴高 → oversteer。
- G-G 区域图对 0.1 g 网格逐格计算同样的模型：非超限格按平衡标签着色，超限 / 离地格归入红色超限区；每隔 1 秒仅在参数变化时重算一次。
- **轮胎宽度 WIDTH 没有进入这条 AC 载荷敏感幂律**，因此页面不做宽度输入；它显示所选胶料的实际宽度，并说明前后曲线为何重合。
- **本模型只模拟底盘重心 / 载荷转移和载荷敏感 μ(Fz)**；轮胎滑移角、滑移率、侧偏刚度与轮胎松弛对 μ 的影响全部忽略。μ 曲线仅随垂向载荷变化。
- AC 前后轴制动分配不是滑移模型的一部分：即使忽略滑移对 μ 的影响，纵向力如何分到前后轴仍会决定每轴合成需求与联合利用率，因此作为显式假设。

## 运行与测试

直接双击 `index.html`，或在本目录运行：

```powershell
Start-Process ".\index.html"
```

物理模型断言：

```powershell
node tests/model.test.js
```

当前 19 项测试覆盖：默认 GT86 载荷与平衡、左右轮载荷守恒、每只轮胎的 AC 幂律、三种胶料参数、四车几何 / 驱动 / 制动 / 轮胎默认值、自定义制动占比、RWD / FWD / AWD 驱动分配、正负侧向 G 的转向 / 载荷侧对称性、前后刚度对抓地力的方向性、零载荷敏感度下刚度不改变平衡、自动配平的成功与不可达边界、轮荷截断与离地警告、总抓地力超限、纵向载荷转移、二维 G 对平衡的影响、轮距对侧倾刚度的影响、参考转弯半径、弹簧率 200 N/mm 上限。

## 文件

```text
index.html            页面结构
styles.css            仪表台与响应式样式
model.js              纯函数稳态模型 + 四车数据（UMD，可在 Node 测试）
app.js                UI、车型 / 轮胎选择、二维 G-G 面板、区域预计算、回放、图表
scene3d.js            Three.js 3D 底盘、悬架、弹簧、ARB、相机控制
tests/model.test.js   模型测试
vendor/three.min.js   Three.js r149（MIT）
vendor/THREE-LICENSE.txt
docs/                 验收截图
```

## 边界

这是用于解释和参数探索的**稳态机构 / 轮胎合力模型**，不是 AC 物理引擎复刻或圈速模拟器。

- **仅模拟载荷转移 + 荷重 μ**；不含轮胎滑移角 / 滑移率对 μ 的建模。
- 3D 底盘只按所选车型的轴距 / 轮距缩放；STRUT / DWB 几何与连接点是通用简化示意，不逐车复刻硬点，也不区分各车车身外形。正侧向 G 按右转、负侧向 G 按左转处理。
- 驱动形式默认来自 `drivetrain.ini`；AWD 统一按 50/50 近似，未建模中央差速器 / DCCD 分配。制动占比可在页面调整；四车原厂 `COCKPIT_ADJUSTABLE = 0`，因此滑块是分析用自定义。
- 不含：空气动力学、差速器锁止、动态 EBD、轮胎纵向松弛、侧倾中心 / 几何载荷转移、轮胎温度 / 压力、Camber / Toe、瞬态响应。
- 联合抓地力按摩擦圆处理（各方向 μ 相同），不区分轮胎纵向 / 侧向各向异性。
- 所有结果用于比较趋势，不作绝对圈速或极限驾驶预测。

外部参考：[CSP suspension docs](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Cars-%E2%80%93-Suspension)、[OptimumG springs & dampers](https://optimumg.com/wp-content/uploads/2020/01/SpringsDampers_Tech_Tip_2.pdf)、[Three.js](https://threejs.org/)。
