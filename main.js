import {
	Scene,
	PerspectiveCamera,
	DirectionalLight,
	Mesh,
	IcosahedronGeometry,
	MeshStandardMaterial,
	WebGLRenderer,
	Color,
	RepeatWrapping,
	Group,
	ShaderMaterial,
	BackSide,
	AdditiveBlending,
	TextureLoader,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import vertexShader from "./shaders/vertex.glsl"
import fragmentShader from "./shaders/fragment.glsl"
import "./style.css"

const loadTexture = async (url) => {
	let textureLoader = new TextureLoader()
	return new Promise((resolve) => {
		textureLoader.load(url, (texture) => {
			resolve(texture)
		})
	})
}

const params = {
	sunIntensity: 1.8,
	speedFactor: 4,
	metalness: 0.1,
	atmOpacity: { value: 1 },
	atmPowFactor: { value: 3 },
	atmMultiplier: { value: 10 },
}
const canvas = document.getElementById("canvas")
let height = window.innerHeight
let width = window.innerWidth
let aspectRatio = width / height

window.addEventListener("resize", () => {
	height = window.innerHeight
	width = window.innerWidth
	aspectRatio = width / height
})

const animate = (renderer, scene, camera, earth, clouds, lastFrameTime) => {
	renderer.render(scene, camera)
	// Get the current timestamp (in milliseconds)
	const currentFrameTime = performance.now()
	const deltaTime = (currentFrameTime - lastFrameTime) / 1000
	// Update the scene with deltaTime
	updateScene(deltaTime, earth, clouds) // assuming earth and clouds are the first two children

	// Render the scene
	requestAnimationFrame(() =>
		animate(renderer, scene, camera, earth, clouds, currentFrameTime)
	)
}

const updateScene = (deltaTime, earth, clouds) => {
	// Rotate Earth and clouds based on a fixed time step
	const rotationSpeedEarth = 0.005 * params.speedFactor // Constant speed
	const rotationSpeedClouds = 0.01 * params.speedFactor // Constant speed

	// Apply the rotation using deltaTime (the time since the last frame)
	earth.rotation.y += rotationSpeedEarth * deltaTime
	clouds.rotation.y += rotationSpeedClouds * deltaTime

	// Access the shader if needed
	const shader = earth.material.userData.shader
	if (shader) {
		// Calculate UV offset based on Earth's rotation
		let offset = (deltaTime * rotationSpeedEarth) / (2 * Math.PI) // Use deltaTime here instead of elapsedTime
		// Update the uniform in the shader with the calculated offset, using modulo to keep it between 0 and 1
		shader.uniforms.uv_xOffset.value =
			(shader.uniforms.uv_xOffset.value + offset) % 1
	}
}

const scene = new Scene()
scene.background = new Color(0x000000)

const camera = new PerspectiveCamera(45, aspectRatio, 1, 1000)
camera.position.set(0, 0, 3)
camera.lookAt(0, 0, 0)
scene.add(camera)

const renderer = new WebGLRenderer({
	canvas,
	antialias: true,
})
renderer.setSize(width, height)
renderer.setPixelRatio(window.devicePixelRatio)

// const controls = new OrbitControls(camera, renderer.domElement)
// scene.add(controls)

const sunLight = new DirectionalLight(0xffffff, params.sunIntensity)
sunLight.position.set(-50, 0, 30)
scene.add(sunLight)

const globeGroup = new Group()
globeGroup.rotation.z = (23.4 * Math.PI) / 180

const albedo = await loadTexture("/images/Albedo.jpg")
const bumpMap = await loadTexture("/images/Bump.jpg")
const cloudsMap = await loadTexture("/images/Clouds.png")
const lightsMap = await loadTexture("/images/Night_Lights.png")
const oceansMap = await loadTexture("/images/Ocean.png")

const geometry = new IcosahedronGeometry(1, 12)

const earthMat = new MeshStandardMaterial({
	map: albedo,
	bumpMap: bumpMap,
	bumpScale: 0.03,
	roughnessMap: oceansMap,
	metalness: params.metalness,
	metalnessMap: oceansMap,
	emissiveMap: lightsMap,
	emissive: new Color(0xffff88),
})
const earthMesh = new Mesh(geometry, earthMat)
globeGroup.add(earthMesh)

const cloudsMat = new MeshStandardMaterial({
	alphaMap: cloudsMap,
	transparent: true,
	// color: new Color(0xff0000),
})
const cloudsMesh = new Mesh(geometry, cloudsMat)
cloudsMesh.scale.set(1.02, 1.02, 1.02)
globeGroup.add(cloudsMesh)

earthMesh.rotateY(-0.3)
cloudsMesh.rotateY(-0.3)

const atmosMat = new ShaderMaterial({
	vertexShader,
	fragmentShader,
	uniforms: {
		atmOpacity: params.atmOpacity,
		atmPowFactor: params.atmPowFactor,
		atmMultiplier: params.atmMultiplier,
	},
	blending: AdditiveBlending,
	side: BackSide,
})
const atmosMesh = new Mesh(geometry, atmosMat)
atmosMesh.scale.set(1.1, 1.1, 1.1)
globeGroup.add(atmosMesh)

scene.add(globeGroup)
// Inject custom shader for cloud shadows
earthMat.onBeforeCompile = function (shader) {
	shader.uniforms.tClouds = { value: cloudsMap }
	shader.uniforms.tClouds.value.wrapS = RepeatWrapping
	shader.uniforms.uv_xOffset = { value: 0 }
	shader.fragmentShader = shader.fragmentShader.replace(
		"#include <common>",
		`
        #include <common>
        uniform sampler2D tClouds;
        uniform float uv_xOffset;
      `
	)
	shader.fragmentShader = shader.fragmentShader.replace(
		"#include <roughnessmap_fragment>",
		`
        float roughnessFactor = roughness;

        #ifdef USE_ROUGHNESSMAP

          vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
          texelRoughness = vec4(1.0) - texelRoughness;
          roughnessFactor *= clamp(texelRoughness.g, 0.5, 1.0);

        #endif
      `
	)
	shader.fragmentShader = shader.fragmentShader.replace(
		"#include <emissivemap_fragment>",
		`
      #ifdef USE_EMISSIVEMAP

        vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );

        emissiveColor *= 1.0 - smoothstep(-0.02, 0.0, dot(vNormal, directionalLights[0].direction));

        totalEmissiveRadiance *= emissiveColor.rgb;

      #endif

      float cloudsMapValue = texture2D(tClouds, vec2(vMapUv.x - uv_xOffset, vMapUv.y)).r;

      diffuseColor.rgb *= max(1.0 - cloudsMapValue, 0.2 );

      float intensity = 1.4 - dot(vNormal, vec3( 0.0, 0.0, 1.0 ));
      vec3 atmosphere = vec3( 0.3, 0.6, 1.0 ) * pow(intensity, 5.0);
      diffuseColor.rgb += atmosphere;
    `
	)

	// need save to userData.shader in order to enable our code to update values in the shader uniforms,
	// reference from https://github.com/mrdoob/three.js/blob/master/examples/webgl_materials_modified.html
	earthMat.userData.shader = shader
}

const initialFrameTime = performance.now()
animate(renderer, scene, camera, earthMesh, cloudsMesh, initialFrameTime)
