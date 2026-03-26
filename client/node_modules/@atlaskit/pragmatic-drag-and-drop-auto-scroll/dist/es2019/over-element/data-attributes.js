export const dataAttribute = 'data-auto-scrollable';
export const selector = `[${dataAttribute}="true"]`;
export function addScrollableAttribute(element) {
  element.setAttribute(dataAttribute, 'true');
  return () => element.removeAttribute(dataAttribute);
}