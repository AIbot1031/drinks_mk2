// Draw distinct, outlined ingredients behind the opaque reading panels.
export function drawTopping(context, topping, x, y, radius, angle = 0, opacity = 0.82) {
  context.save();
  context.translate(x, y);context.rotate(angle);context.globalAlpha = opacity;
  const jelly = /椰果|仙草|茶凍|粉粿|果肉/.test(topping);
  const pudding = topping === '布丁';
  const cream = /奶蓋|冰淇淋/.test(topping);
  const oat = topping === '燕麥';
  const colors = topping === '椰果' ? ['#fffdf0', '#dac8a3', '#9c825d']
    : topping === '仙草' ? ['#655052', '#2a1f26', '#22171c']
    : /芋/.test(topping) ? ['#cda9dd', '#9a69b0', '#744982']
    : /布丁|粉粿|茶凍/.test(topping) ? ['#ffe59b', '#e3aa37', '#a66d1d']
    : topping === '果肉' ? ['#ffd898', '#f49b56', '#b86730']
    : cream ? ['#fffdf1', '#eadab7', '#b29a70']
    : oat ? ['#ecd0a1', '#c19c68', '#987547']
    : ['#795b4c', '#32201c', '#241512'];
  const fill = context.createLinearGradient(-radius, -radius, radius, radius);
  fill.addColorStop(0, colors[0]);fill.addColorStop(1, colors[1]);
  context.fillStyle = fill;context.strokeStyle = colors[2];context.lineWidth = 1.4;
  context.beginPath();
  if (pudding) {
    context.moveTo(-radius * 0.65, -radius * 0.65);context.lineTo(radius * 0.65, -radius * 0.65);
    context.lineTo(radius, radius * 0.6);context.quadraticCurveTo(0, radius * 1.05, -radius, radius * 0.6);context.closePath();
  } else if (jelly) context.roundRect(-radius * 0.85, -radius * 0.75, radius * 1.7, radius * 1.5, radius * 0.18);
  else if (cream) {
    context.moveTo(-radius, radius * 0.5);
    context.bezierCurveTo(-radius * 1.4, -radius * 0.1, -radius * 0.5, -radius * 0.7, -radius * 0.3, -radius * 0.4);
    context.bezierCurveTo(0, -radius * 1.25, radius * 0.9, -radius * 0.6, radius * 0.7, -radius * 0.15);
    context.bezierCurveTo(radius * 1.45, 0, radius * 1.15, radius * 0.75, radius * 0.5, radius * 0.7);context.closePath();
  } else if (oat) context.ellipse(0, 0, radius * 0.5, radius, 0.35, 0, Math.PI * 2);
  else if (/芋/.test(topping)) context.roundRect(-radius, -radius * 0.7, radius * 2, radius * 1.4, radius * 0.6);
  else context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();context.stroke();
  if (pudding) {
    context.beginPath();context.ellipse(0, -radius * 0.62, radius * 0.66, radius * 0.2, 0, 0, Math.PI * 2);
    context.fillStyle = '#ab622c';context.fill();
  }
  // A bright glint makes dark pearls readable on every tea theme.
  context.beginPath();context.ellipse(-radius * 0.28, -radius * 0.28, radius * 0.27, radius * 0.14, -0.6, 0, Math.PI * 2);
  context.fillStyle = '#fff9e8';context.globalAlpha = opacity * 0.73;context.fill();
  context.restore();
}
