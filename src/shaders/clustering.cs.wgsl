// TODO-2: implement the light clustering compute shader
@group(${bindGroup_scene}) @binding(0) var<uniform> camera: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> clusterSet: ClusterSet;

// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

fn clip2View(clip: vec4f) -> vec4f {
    var view = camera.invProjMat * clip;
    view = view / view.w;
    return view;
}

fn screen2View(screen: vec4f) -> vec4f {
    let texCoord = screen.xy / vec2f(camera.screenWidth, camera.screenHeight);
    let clip = vec4f(vec2f(texCoord.x, 1.0 - texCoord.y) * 2.0 - 1.0, screen.z, screen.w);
    return clip2View(clip);
}

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster's bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.

fn lineIntersectionToZPlane(A: vec3f, B: vec3f, zDistance: f32) -> vec3f {
    let normal = vec3f(0.0, 0.0, 1.0);
    let ab =  B - A;
    let t = (zDistance - dot(normal, A)) / dot(normal, ab);
    let result = A + t * ab;
    return result;
}

@compute @workgroup_size(${workgroupSizeX}, ${workgroupSizeY}, ${workgroupSizeZ})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (global_id.x >= ${numClustersX} || 
        global_id.y >= ${numClustersY} || 
        global_id.z >= ${numClustersZ}) {
        return;
    }
    
    let index = global_id.x + 
                global_id.y * ${numClustersX} + 
                global_id.z * ${numClustersX} * ${numClustersY};
    
    let cluster_size_x = camera.screenWidth / f32(${numClustersX});
    let cluster_size_y = camera.screenHeight / f32(${numClustersY});
    
    let min_x = f32(global_id.x) * cluster_size_x;
    let max_x = min_x + cluster_size_x;
    let min_y = f32(global_id.y) * cluster_size_y;
    let max_y = min_y + cluster_size_y;

    let min_screen  = vec4f(min_x, min_y, -1.0, 1.0);
    let max_screen  = vec4f(max_x, max_y, -1.0, 1.0);
    let min_view    = screen2View(min_screen).xyz;
    let max_view    = screen2View(max_screen).xyz;
    let tileNear    = -camera.nearZ * 
                      pow(camera.farZ / camera.nearZ, 
                      f32(global_id.z) / f32(${numClustersZ}));
    let tileFar     = -camera.nearZ * 
                      pow(camera.farZ / camera.nearZ, 
                      f32(global_id.z + 1u) / f32(${numClustersZ}));

    let eyePos = vec3f(0.0);
    let minPointNear = lineIntersectionToZPlane(eyePos, min_view, tileNear);
    let minPointFar  = lineIntersectionToZPlane(eyePos, min_view, tileFar);
    let maxPointNear = lineIntersectionToZPlane(eyePos, max_view, tileNear);
    let maxPointFar  = lineIntersectionToZPlane(eyePos, max_view, tileFar);
    
    let min_bounds = min(min(minPointNear, minPointFar), min(maxPointNear, maxPointFar));
    let max_bounds = max(max(minPointNear, minPointFar), max(maxPointNear, maxPointFar));

    // Assigning lights to clusters:
    clusterSet.clusters[index].numLights = 0u;
    for (var lightIdx = 0u; lightIdx < lightSet.numLights; lightIdx++) {
        let lightWorld = lightSet.lights[lightIdx].pos;
        let lightView = camera.viewMat * vec4f(lightWorld, 1.0);
        if (lightIntersect(lightView.xyz, min_bounds, max_bounds, ${lightRadius})) {
            let count = clusterSet.clusters[index].numLights;
            if (count < ${maxNumLights}) {
                clusterSet.clusters[index].lightIndices[count] = lightIdx;
                clusterSet.clusters[index].numLights += 1u;
            }
        }
    }
}
