import { useRef } from 'react';
import { Animated } from 'react-native';

export const useMicPulse = () => {
  const anim = useRef(new Animated.Value(1)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  const start = () => {
    loop.current = Animated.loop(Animated.sequence([
          Animated.timing(anim, { toValue: 1.2, duration: 700, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]));
        loop.current.start();
  };

  const stop = () => {
    loop.current?.stop(); anim.setValue(1);
  };

  return { anim, start, stop };
};

export const useSpeakerPulse = () => {
  const anim = useRef(new Animated.Value(1)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  const start = () => {
    loop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.2, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.current.start();
  };

  const stop = () => {
    loop.current?.stop();
    anim.setValue(1);
  };

  return { anim, start, stop };
};
