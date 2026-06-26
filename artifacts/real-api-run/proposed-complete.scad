// ==============================
// 30ML量杯模型（修正版）
// ==============================
// 参数定义（单位：毫米）
$fn = 36;           // 圆形精度（降低以加快预览）

// 杯体参数（调整比例使内部容积接近30毫升）
bottom_d = 30;      // 底部直径
top_d = 40;         // 顶部直径（外扩）
cup_h = 38;         // 杯体高度
wall = 1.5;         // 壁厚
base_h = 2;         // 底部厚度

// 把手参数（调整比例）
handle_r = 6;       // 把手弯曲半径
handle_thick = 3;   // 把手粗细
handle_h = 22;      // 把手高度
handle_tilt = 8;    // 把手向外倾斜角度

// 刻度线参数
mark_count = 5;     // 刻度数量（每10ml一条）
mark_w = 1.5;       // 刻度线宽度
mark_d = 0.4;       // 刻度线深度（凸出杯壁）
mark_offset = 0.5;  // 刻度线离杯壁距离

// ==============================
// 杯身主体模块
// ==============================
module cup_body() {
    difference() {
        // 外壳 - 从底部到顶部逐渐扩大
        cylinder(d1 = bottom_d, d2 = top_d, h = cup_h);
        
        // 内腔 - 挖空（从底部开始，但留出底厚）
        translate([0, 0, base_h])
            cylinder(
                d1 = bottom_d - 2 * wall, 
                d2 = top_d - 2 * wall, 
                h = cup_h - base_h + 1
            );
    }
}

// ==============================
// 底座模块 - 与杯身平滑连接
// ==============================
module cup_base() {
    // 使用圆台形状，与杯身底部平滑连接
    translate([0, 0, -0.01]) {
        difference() {
            cylinder(
                d1 = bottom_d + 4, 
                d2 = bottom_d, 
                h = 3
            );
            
            // 内部空腔（与杯身内腔连通）
            translate([0, 0, -0.1])
                cylinder(
                    d1 = bottom_d + 4 - 2 * wall,
                    d2 = bottom_d - 2 * wall,
                    h = 3.2
                );
        }
    }
}

// ==============================
// 把手模块 - 修正C形弯曲实现
// ==============================
module handle() {
    // 计算杯体侧面位置（杯身平均半径）
    side_r = (bottom_d + top_d) / 4;  // 平均半径
    
    // 把手位置（杯身上部）
    handle_z = cup_h * 0.55;
    
    // 主连接柱（连接杯身与把手）
    translate([side_r, 0, handle_z])
    rotate([0, -handle_tilt, 0]) {
        // 连接柱
        cylinder(
            d = handle_thick, 
            h = handle_h * 0.4,
            center = false
        );
    }
    
    // C形环部分
    translate([side_r + handle_thick/2 + handle_r, 0, handle_z + handle_h * 0.4])
    rotate([0, 90 - handle_tilt, 0]) {
        difference() {
            // 外圆环
            cylinder(r = handle_r + handle_thick/2, h = handle_thick, center = true);
            // 内圆环
            cylinder(r = handle_r - handle_thick/2, h = handle_thick + 0.1, center = true);
            // 切掉一半，形成C形
            translate([handle_r + handle_thick, 0, 0])
                cube([2 * handle_r + handle_thick, 2 * handle_r + handle_thick, handle_thick + 1], center = true);
        }
    }
}

// ==============================
// 刻度线模块 - 修正半径计算
// ==============================
module graduation_marks() {
    for (i = [1 : mark_count]) {
        // 计算每条刻度的高度位置（从底部开始均匀分布）
        z_pos = base_h + (cup_h - base_h - 5) * (i / mark_count);
        
        // 计算该高度的杯壁外部半径（线性插值）
        // 外半径 = 底部半径 + (顶部半径 - 底部半径) * (高度比例)
        height_ratio = z_pos / cup_h;
        r_pos = bottom_d/2 + (top_d/2 - bottom_d/2) * height_ratio;
        
        // 刻度线应凸出杯壁
        translate([0, 0, z_pos]) {
            for (angle = [0 : 90 : 270]) {  // 每90度一条刻度，避免重叠
                rotate([0, 0, angle])
                translate([r_pos - mark_offset, -mark_w/2, 0])
                    cube([mark_d, mark_w, 0.8]);
            }
        }
    }
}

// ==============================
// 主组装
// ==============================
module measuring_cup_30ml() {
    union() {
        cup_body();
        cup_base();
        handle();
        graduation_marks();
        
        // 杯口边缘加厚（便于拿握）
        translate([0, 0, cup_h - 1])
            difference() {
                cylinder(d1 = top_d, d2 = top_d + 1, h = 1);
                translate([0, 0, -0.1])
                    cylinder(d1 = top_d - 2 * wall, d2 = top_d + 1 - 2 * wall, h = 1.2);
            }
    }
}

// 渲染模型
measuring_cup_30ml();