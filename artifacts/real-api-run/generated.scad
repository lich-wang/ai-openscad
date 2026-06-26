// ==============================
// 30ML量杯模型
// ==============================
// 参数定义（单位：毫米）
$fn = 60;           // 圆形精度

// 杯体参数
bottom_d = 28;      // 底部直径
top_d = 36;         // 顶部直径（外扩）
cup_h = 45;         // 杯体高度
wall = 1.5;         // 壁厚
base_h = 2;         // 底部厚度

// 把手参数
handle_r = 8;       // 把手弯曲半径
handle_thick = 4;   // 把手粗细
handle_h = 26;      // 把手高度
handle_tilt = 12;   // 把手向外倾斜角度

// 刻度线参数
mark_count = 5;     // 刻度数量（每10ml一条）
mark_w = 2;         // 刻度线宽度
mark_d = 0.5;       // 刻度线深度

// ==============================
// 杯身主体模块
// ==============================
module cup_body() {
    difference() {
        // 外壳 - 从底部到顶部逐渐扩大
        cylinder(d1 = bottom_d, d2 = top_d, h = cup_h);
        
        // 内腔 - 挖空
        translate([0, 0, base_h])
            cylinder(
                d1 = bottom_d - 2 * wall, 
                d2 = top_d - 2 * wall, 
                h = cup_h - base_h + 1
            );
    }
}

// ==============================
// 底座模块 - 增加稳定性
// ==============================
module cup_base() {
    difference() {
        cylinder(d1 = bottom_d + 2, d2 = bottom_d, h = 3);
        translate([0, 0, -0.1])
            cylinder(d = bottom_d - 2 * wall, h = 3.2);
    }
}

// ==============================
// 把手模块 - C形小把手
// ==============================
module handle() {
    // 计算杯体侧面位置
    side_pos = (bottom_d + top_d) / 4;  // 杯体侧面平均半径
    
    translate([side_pos, 0, cup_h * 0.45])
    rotate([0, handle_tilt, 0]) {
        difference() {
            // 外圆环
            cylinder(r = handle_r + handle_thick / 2, h = handle_h, center = true);
            // 内圆环
            cylinder(r = handle_r - handle_thick / 2, h = handle_h + 1, center = true);
            // 切掉一半，形成C形
            translate([handle_r + 10, 0, 0])
                cube([20 + handle_thick, 20 + handle_thick, handle_h + 2], center = true);
        }
    }
}

// ==============================
// 刻度线模块
// ==============================
module graduation_marks() {
    for (i = [1 : mark_count]) {
        // 计算每条刻度的高度位置
        z_pos = base_h + (cup_h - base_h - 5) * (i / mark_count);
        // 计算该高度的半径（锥形杯壁）
        r_pos = (bottom_d / 2) + (top_d - bottom_d) / 2 * (z_pos / cup_h);
        
        translate([0, 0, z_pos])
        rotate([0, 0, i * 60])  // 交替角度避免重叠
            translate([r_pos - mark_d / 2, -mark_w / 2, 0])
                cube([mark_d + wall, mark_w, 0.8]);
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
    }
}

// 渲染模型
measuring_cup_30ml();

// ==============================
// 可选：打印时取消注释下方代码，将模型平放在底面
// ==============================
// translate([0, 0, 0]) measuring_cup_30ml();