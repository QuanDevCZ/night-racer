// Post: bloom for the neon, then a radial speed blur + chromatic fringe + vignette that scale with speed.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SpeedShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0 }, vignette: { value: 0.35 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float strength; uniform float vignette; varying vec2 vUv;
    void main() {
      vec2 c = vec2(0.5, 0.55);
      vec2 d = vUv - c;
      float r = length(d);
      float amt = strength * smoothstep(0.12, 0.7, r);   // the centre stays sharp
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 10; i++) {
        float t = float(i) / 9.0;
        vec2 uv = vUv - d * amt * t * 0.16;
        acc.r += texture2D(tDiffuse, uv + d * amt * 0.006).r;
        acc.g += texture2D(tDiffuse, uv).g;
        acc.b += texture2D(tDiffuse, uv - d * amt * 0.006).b;
      }
      vec3 col = acc / 10.0;
      col *= 1.0 - vignette * smoothstep(0.35, 0.95, r * (1.0 + strength * 0.4));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.5, 0.9);
  composer.addPass(bloom);
  const speed = new ShaderPass(SpeedShader);
  composer.addPass(speed);
  composer.addPass(new OutputPass());
  return {
    composer, bloom,
    setSpeed(v) { speed.uniforms.strength.value = v; speed.enabled = v > 0.01; },
    setSize(w, h) { composer.setSize(w, h); },
    setPixelRatio(pr) { composer.setPixelRatio(pr); },
    render() { composer.render(); },
  };
}
