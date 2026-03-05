export type NavDrawerState = {
  isOpen: boolean;
  openedOnPath: string;
};

export function openDrawer(pathname: string): NavDrawerState {
  return { isOpen: true, openedOnPath: pathname };
}

export function closeDrawer(state: NavDrawerState): NavDrawerState {
  return { ...state, isOpen: false };
}

export function getIsDrawerOpen(
  state: NavDrawerState,
  pathname: string,
): boolean {
  return state.isOpen && state.openedOnPath === pathname;
}
