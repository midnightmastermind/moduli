var vertical = {
  start: 'top',
  end: 'bottom',
  point: 'y',
  size: 'height'
};
var horizontal = {
  start: 'left',
  end: 'right',
  point: 'x',
  size: 'width'
};
export var axisLookup = {
  vertical: {
    mainAxis: vertical,
    crossAxis: horizontal
  },
  horizontal: {
    mainAxis: horizontal,
    crossAxis: vertical
  }
};