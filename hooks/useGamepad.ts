import { useEffect, useRef, useState } from 'react';

export interface GamepadState {
  buttons: readonly GamepadButton[];
  axes: readonly number[];
  id: string;
  index: number;
}

export const useGamepad = (
  onButtonDown?: (buttonIndex: number) => void,
  onButtonUp?: (buttonIndex: number) => void,
  pollInterval: number = 16
) => {
  const [gamepads, setGamepads] = useState<Record<number, GamepadState>>({});
  const requestRef = useRef<number>();
  const prevButtonsRef = useRef<Record<number, readonly GamepadButton[]>>({});

  const onButtonDownRef = useRef(onButtonDown);
  const onButtonUpRef = useRef(onButtonUp);

  useEffect(() => {
      onButtonDownRef.current = onButtonDown;
      onButtonUpRef.current = onButtonUp;
  }, [onButtonDown, onButtonUp]);

  const scanGamepads = () => {
    const connectedGamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const newGamepads: Record<number, GamepadState> = {};

    for (const gp of connectedGamepads) {
      if (gp) {
        newGamepads[gp.index] = {
          buttons: gp.buttons,
          axes: gp.axes,
          id: gp.id,
          index: gp.index,
        };

        const prevButtons = prevButtonsRef.current[gp.index] || [];
        gp.buttons.forEach((btn, btnIdx) => {
            const wasPressed = prevButtons[btnIdx]?.pressed || false;
            const isPressed = btn.pressed;

            if (isPressed && !wasPressed && onButtonDownRef.current) {
                onButtonDownRef.current(btnIdx);
            }
            if (!isPressed && wasPressed && onButtonUpRef.current) {
                onButtonUpRef.current(btnIdx);
            }
        });
        prevButtonsRef.current[gp.index] = gp.buttons;
      }
    }
    setGamepads(newGamepads);
    requestRef.current = requestAnimationFrame(scanGamepads);
  };

  useEffect(() => {
    window.addEventListener("gamepadconnected", scanGamepads);
    window.addEventListener("gamepaddisconnected", scanGamepads);
    requestRef.current = requestAnimationFrame(scanGamepads);

    return () => {
      window.removeEventListener("gamepadconnected", scanGamepads);
      window.removeEventListener("gamepaddisconnected", scanGamepads);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return gamepads;
};
