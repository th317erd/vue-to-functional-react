import { shallow as _shallow } from 'enzyme';

export function shallow(_component) {
  const component = _shallow(_component).dive().dive();
  return component;
}
