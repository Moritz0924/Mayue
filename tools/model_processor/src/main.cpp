\
#include <filesystem>
#include <fstream>
#include <iostream>

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "Usage: model_processor <input_model.glb> <output_dir>\n";
        return 1;
    }
    std::filesystem::path in = argv[1];
    std::filesystem::path outdir = argv[2];
    std::filesystem::create_directories(outdir);

    // MVP：先原样拷贝为 building_lite.glb（后续接真正轻量化处理）
    auto outModel = outdir / "building_lite.glb";
    std::filesystem::copy_file(in, outModel, std::filesystem::copy_options::overwrite_existing);

    // MVP：生成假的映射表（后续从模型解析生成）
    auto outMap = outdir / "building_lite.map.json";
    std::ofstream f(outMap);
    f << R"({"model_id":"demo_001","elements":[{"element_id":"E1001","name":"Column-1F-A"},{"element_id":"E1002","name":"Beam-1F-01"}]})";
    f.close();

    std::cout << "OK: " << outModel.string() << "\n";
    std::cout << "OK: " << outMap.string() << "\n";
    return 0;
}
