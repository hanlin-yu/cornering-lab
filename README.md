# GT86 Cornering Lab

一个面向数据说明与调校直觉的 **GT86 / ZN6 3D 底盘 · 二维 G-G 抓地平衡实验台**。

打开 [`index.html`](./index.html) 即可运行。页面无网络请求、无 CDN，Three.js 已本地化到 `vendor/`。

![桌面预览](docs/preview-desktop.png)

在线版本：[hanlin-yu.github.io/gt86-cornering-lab](https://hanlin-yu.github.io/gt86-cornering-lab/)

## 功能

- **二维 G-G 输入面板**：横向拖动设置纵向 G（制动 / 加速），纵向拖动设置侧向 G；支持鼠标、触摸、方向键，实时更新全部数据。轨迹会保留最近 220 个点。
- **入弯 → 弯心 → 出弯回放**：6.2 秒自动扫过从制动入弯、trail braking 到加速出弯的连续 G 组合；状态、载荷、轴抓地力、3D 底盘、弹簧、ARB 与 μ–Fz 曲线同步刷新。
- 可旋转 / 缩放的 3D 底盘：前麦弗逊、后双叉臂、四组弹簧-减振器、前后防倾杆、下控制臂、上横臂、转向拉杆、轮毂与轮胎。
- 3D **CoG 质心标签 + 垂线 / 地面投影**；G 力箭头长度由合成 G 决定，方向表示惯性力（左弯指向外侧，加速指向后方）。
- 每个车轮的 3D 标签显示当前轮荷与相对静态轮荷的变化百分比；外轮为正、内轮为负。纵向 G 会同时改变前后轴的两个轮荷。
- 前后弹簧率可在 **8–200 N/mm** 范围内调节；ARB 保持 0–80 / 0–60 N/mm。
- **AC 轮胎选择**：ECO / Street / Semislicks / 自定义。AC 模式只读；自定义模式可编辑基准 **μ_ref** 与载荷敏感指数 **k**。
- **μ–Fz 曲线面板**：显示当前前 / 后轴曲线、四个车轮所在的实际轮荷点，以及每个点的 Fz / μ。GT86 前后轮胎参数相同，所以两条曲线重合；WIDTH 不进入该载荷敏感幂律。
- **模型范围说明**：仅模拟底盘重心 / 载荷转移与载荷敏感 μ(Fz)；忽略轮胎滑移角、滑移率对 μ 的影响。
- 轴卡显示总抓地力、合成需求（侧向 + 纵向）、联合利用率、侧向载荷转移、外 / 内轮载荷、簧 + 杆轮端刚度、Fx / Fy 分解。
- 调校预设：GT86 原厂、前轴加硬、后轴加硬、自动配平（求前 ARB 使前后利用率相等；无法达到时如实报告边界）。
- 高级参数：整车质量、前轴荷、质心高度。
- 内侧轮离地、轴荷卸载、总抓地力不足、单轴极限、低载荷敏感度等警告。

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
| 轮胎胶料 | ECO / Street / Semislicks | `tyres.ini [ECO] / [STREET] / [SEMISLICKS]` |
| Semislicks 参考载荷 / 摩擦 / 载荷敏感 | FZ0 2494 N, DY_REF 1.28, LS_EXPY 0.8119 | `[FRONT_2]/[REAR_2]` |
| Street 参考载荷 / 摩擦 / 载荷敏感 | FZ0 2274 N, DY_REF 1.23, LS_EXPY 0.8227 | `[FRONT_1]/[REAR_1]` |
| ECO 参考载荷 / 摩擦 / 载荷敏感 | FZ0 2274 N, DY_REF 1.215, LS_EXPY 0.7227 | `[ECO] FRONT/REAR` |
| 轮胎宽度 F / R | 215 / 215 mm | `WIDTH`；不进入本车 μ(Fz) 幂律 |
| 轮胎垂向刚度 | 262593 N/m | 用于 3D 中轮胎压缩的视觉化 |

ARB 的原始文件注释与 CSP 文档对单位表述存在差异；本项目把 `[ARB]` 值当作轮端等效刚度处理，页面中也明确标注了模型边界。

## 模型

```text
Kφ,axle    = (k_spring + k_ARB) · t² / 2
share_F    = Kφ,F / (Kφ,F + Kφ,R)
ΔFz_lat,F  = share_F · m · a_y · h / t_F
ΔFz_long   = m · a_x · h / L
Fz_F       = Fz_F,static − ΔFz_long
Fz_R       = Fz_R,static + ΔFz_long

k          = 1 − LS_EXPY
μ(Fz)      = μ_ref · (Fz / FZ0)^(−k)
Fy,max     = μ(Fz) · Fz
Fgrip,axle = Σ Fy,max

Fx,front / Fx,rear = 制动按 60 / 40；加速时 0 / 100（RWD）
F_res,axle = √(Fy,demand² + Fx,demand²)
U          = F_res,axle / Fgrip,axle
ΔFz%       = ΔFz_lat / Fz_axle
```

- 悬架弹簧与 ARB 首先合并成轴轮端刚度，再给出前后侧倾刚度分配。侧向载荷转移只由侧倾刚度分配决定。
- 纵向 G 通过质心高度与轴距在前后轴间转移垂直载荷；每个车轮的 μ 按其实际 Fz 查曲线。
- 前 / 后轴总抓地力是该轴两只轮胎的 `Fy,max` 之和。
- 合成需求包含侧向需求和纵向需求；利用率高的一轴先达到联合极限：前轴高 → understeer；后轴高 → oversteer。
- **轮胎宽度 WIDTH 没有进入这条 AC 载荷敏感幂律**，因此页面不做宽度输入；它显示 AC 数据中的 215/215 mm，并说明前后曲线为何重合。
- **本模型只模拟底盘重心 / 载荷转移和载荷敏感 μ(Fz)**；轮胎滑移角、滑移率、侧偏刚度与轮胎松弛对 μ 的影响全部忽略。μ 曲线仅随垂向载荷变化。
- 未使用 `loadTransferLoss` 之类的等效线性抓地损失系数。GT86 这组轮胎数据没有 `DY_CURVE`，使用上述幂律；测得的 k 分别为 ECO 0.2773、Street 0.1773、Semislicks 0.1881。

## 运行与测试

直接双击 `index.html`，或在本目录运行：

```powershell
Start-Process ".\index.html"
```

物理模型断言：

```powershell
node tests/model.test.js
```

当前覆盖：默认 GT86 载荷与平衡、左右轮载荷守恒、每只轮胎的 AC 幂律、三种胶料参数、前后刚度对抓地力的方向性、零载荷敏感度下刚度不改变平衡、自动配平的成功与不可达边界、轮荷截断与离地警告、总抓地力超限、纵向载荷转移、RWD / 制动纵向力分配、二维 G 对平衡的影响、轮距对侧倾刚度的影响、参考转弯半径、弹簧率 200 N/mm 上限。

## 文件

```text
index.html            页面结构
styles.css            仪表台与响应式样式
model.js              纯函数稳态模型（UMD，可在 Node 测试）
app.js                UI、二维 G-G 面板、回放、图表、预设、自动配平
scene3d.js            Three.js 3D 底盘、悬架、弹簧、ARB、相机控制
tests/model.test.js   模型测试
vendor/three.min.js   Three.js r149（MIT）
vendor/THREE-LICENSE.txt
docs/                 验收截图
```

## 边界

这是用于解释和参数探索的**稳态机构 / 轮胎合力模型**，不是 AC 物理引擎复刻或圈速模拟器。

- **仅模拟载荷转移 + 荷重 μ**；不含轮胎滑移角 / 滑移率对 μ 的建模。
- 不含：空气动力学、差速器锁止、动态 EBD、制动偏置随载荷变化、轮胎纵向松弛、侧倾中心 / 几何载荷转移、轮胎温度 / 压力、Camber / Toe、瞬态响应。
- 驱动力 100% 分配到后轴；制动力按固定 60% 前 / 40% 后近似，因为 `brake.ini` 未纳入该模型。**这不是滑移模型**：即使忽略滑移对 μ 的影响，纵向力如何分到前后轴仍会决定每轴合成需求与联合利用率，因此必须作为显式假设。
- 联合抓地力按摩擦圆处理（各方向 μ 相同），不区分轮胎纵向 / 侧向各向异性。
- 3D 悬架是依据 GT86 的 STRUT / DWB 架构、轴距、轮距和刚度做的**简化机构示意**，不是对 `suspensions.ini` 硬点的逐点复刻。
- 所有结果用于比较趋势，不作绝对圈速或极限驾驶预测。

外部参考：[CSP suspension docs](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Cars-%E2%80%93-Suspension)、[OptimumG springs & dampers](https://optimumg.com/wp-content/uploads/2020/01/SpringsDampers_Tech_Tip_2.pdf)、[Three.js](https://threejs.org/)。
