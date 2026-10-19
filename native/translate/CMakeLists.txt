cmake_minimum_required(VERSION 3.20)
project(rice_translate LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
# Runtime estático no Windows: o .exe não depende do VC++ Redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
if(APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
  set(CMAKE_OSX_DEPLOYMENT_TARGET 11.0)
endif()

option(RICE_WITH_CT2 "Compila o motor real (CTranslate2 + sentencepiece, baixados e fixados por versão). OFF = só o modo --simulate e os testes." ON)

if(MSVC)
  add_compile_options(/W4 /utf-8 /permissive- /EHsc)
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN)
else()
  add_compile_options(-Wall -Wextra -Wno-unused-parameter)
endif()
find_package(Threads REQUIRED)

# Código comum com os helpers de áudio e detector: JSON e emissor de linhas.
set(COMMON ${CMAKE_CURRENT_SOURCE_DIR}/../win/common)
add_library(rice_common STATIC ${COMMON}/json.cpp ${COMMON}/events.cpp)
target_include_directories(rice_common PUBLIC ${COMMON})

add_library(rice_translate_core STATIC src/core.cpp)
target_link_libraries(rice_translate_core PUBLIC rice_common)

add_executable(rice-translate src/main.cpp)
target_link_libraries(rice-translate PRIVATE rice_translate_core Threads::Threads)

if(RICE_WITH_CT2)
  include(FetchContent)
  include(GNUInstallDirs)  # o install() do CTranslate2 usa essas variáveis
  set(CMAKE_POLICY_VERSION_MINIMUM 3.5)  # as dependências antigas pedem cmake_minimum_required < 3.5
  # Versões fixas por tag/commit: o build é reproduzível e nada de rede é usado em tempo de execução.
  set(BUILD_CLI OFF CACHE BOOL "" FORCE)
  set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(OPENMP_RUNTIME NONE CACHE STRING "" FORCE)   # 1 thread: sem OpenMP, sem libomp/libiomp5 para distribuir
  set(WITH_MKL OFF CACHE BOOL "" FORCE)            # MKL pesa dezenas de MB; o Ruy faz int8 em ARM64 e x86-64
  set(WITH_DNNL OFF CACHE BOOL "" FORCE)
  set(WITH_RUY ON CACHE BOOL "" FORCE)
  if(APPLE)
    set(WITH_ACCELERATE ON CACHE BOOL "" FORCE)
  endif()
  set(SPM_ENABLE_SHARED OFF CACHE BOOL "" FORCE)
  set(SPM_BUILD_TEST OFF CACHE BOOL "" FORCE)

  FetchContent_Declare(sentencepiece GIT_REPOSITORY https://github.com/google/sentencepiece.git GIT_TAG v0.2.1 GIT_SHALLOW TRUE)
  FetchContent_Declare(ctranslate2 GIT_REPOSITORY https://github.com/OpenNMT/CTranslate2.git GIT_TAG v4.8.3 GIT_SHALLOW TRUE
                       GIT_SUBMODULES_RECURSE TRUE)
  FetchContent_MakeAvailable(sentencepiece ctranslate2)

  add_library(rice_ct2 STATIC src/ct2_model.cpp)
  target_include_directories(rice_ct2 PUBLIC src ${sentencepiece_SOURCE_DIR}/src)
  target_link_libraries(rice_ct2 PUBLIC rice_translate_core ctranslate2 sentencepiece-static)
  if(APPLE)
    target_compile_definitions(rice_ct2 PRIVATE CT2_WITH_ACCELERATE)
  endif()
  target_compile_definitions(rice-translate PRIVATE RICE_WITH_CT2)
  target_link_libraries(rice-translate PRIVATE rice_ct2)
  if(NOT MSVC)
    target_link_options(rice-translate PRIVATE $<$<CONFIG:Release>:-s>)
  endif()
endif()

enable_testing()
add_executable(rice_translate_tests tests/test_core.cpp)
target_link_libraries(rice_translate_tests PRIVATE rice_translate_core)
add_test(NAME core COMMAND rice_translate_tests)
