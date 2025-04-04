// TODO-3: implement the Clustered Deferred fullscreen fragment shader

// Similar to the Forward+ fragment shader, but with vertex information coming from the G-buffer instead.
@group(${bindGroup_scene}) @binding(0) var<uniform> camera: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;

@group(${bindGroup_gbuffer}) @binding(0) var packTexture: texture_2d<u32>;

struct FragmentInput {
    @builtin(position) fragCoord: vec4f,
    @location(0) uv: vec2f
}

fn reconstructWorldPosition(uv: vec2f, depth: f32) -> vec3f {
    let clipSpacePos = vec4f(uv * 2.0 - 1.0, depth, 1.0);
    let worldSpacePos = camera.invViewProjMat * clipSpacePos;
    return worldSpacePos.xyz / worldSpacePos.w;
}

fn calculateClusterIndex(fragPos: vec3f) -> u32 {
    // Convert in.pos to NDC (-1, 1)
    let screenPos   = camera.viewProjMat * vec4f(fragPos, 1.0);
    let posNDC      = screenPos.xyz / screenPos.w;
    let posView     = camera.viewMat * vec4<f32>(fragPos, 1.0);
    let zDist       = posView.z;

    // Get Index: from (-1, 1) to (0, number)
    let xCluster    = u32((posNDC.x * 0.5 + 0.5) * f32(${numClustersX}));
    let yCluster    = u32((1.0 - (posNDC.y * 0.5 + 0.5)) * f32(${numClustersY}));
    let zCluster    = u32(log(zDist / camera.nearZ) / 
                      log(camera.farZ / camera.nearZ) * 
                      f32(${numClustersZ}));

    let x = min(xCluster, ${numClustersX} - 1u);
    let y = min(yCluster, ${numClustersY} - 1u);
    let z = min(zCluster, ${numClustersZ} - 1u);

    return x +
           y * ${numClustersX} +
           z * ${numClustersX} * ${numClustersY};
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f {
    let texCoord = in.uv;
    let pack = textureLoad(packTexture, vec2i(in.fragCoord.xy), 0);
    
    let normal = decodeNormal(unpack2x16snorm(pack.x));
    let DR = unpack2x16snorm(pack.y);
    let GB = unpack2x16snorm(pack.z);
    let depth = DR.x;
    let albedo = vec3f(DR.y, GB.x, GB.y);
    let position = reconstructWorldPosition(texCoord, depth);

    let id = calculateClusterIndex(vec3f(in.fragCoord.x, in.fragCoord.y, in.fragCoord.z));
    if (id >= ${numClustersX} * ${numClustersY} * ${numClustersZ}) {
        return vec4(1.0, 0.0, 1.0, 1.0);
    }
    let cluster = clusterSet.clusters[id];
    
    // var totalLightContrib = vec3f(0, 0, 0);
    // for (var lightIdx = 0u; lightIdx < lightSet.numLights; lightIdx++) {
    //     let light = lightSet.lights[lightIdx];
    //     totalLightContrib += calculateLightContrib(light, position, normalize(normal));
    // }
    var totalLightContrib = vec3f(0, 0, 0);
    for (var i = 0u; i < cluster.numLights; i++) {
        let lightIdx = cluster.lightIndices[i];
        let light = lightSet.lights[lightIdx];
        totalLightContrib += calculateLightContrib(light, position, normalize(normal));
    }

    // let finalColor = albedo.rgb * totalLightContrib;
    let finalColor = albedo.rgb;
    return vec4(finalColor, 1.0);
}
