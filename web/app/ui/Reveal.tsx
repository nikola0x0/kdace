"use client";
// One item of a list that appears one after another when it scrolls into view (once). Respects reduced motion.
import { motion, useReducedMotion } from "motion/react";

export default function Reveal({ index, children, className }: { index: number; children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, delay: index * 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.li>
  );
}
