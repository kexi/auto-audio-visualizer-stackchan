cmake_minimum_required(VERSION 3.20)
project(stackchan_visualizer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(visualizer_core stackchan/lib/visualizer_core/src/visualizer.cpp)
target_include_directories(visualizer_core PUBLIC stackchan/lib/visualizer_core/include)
target_compile_options(visualizer_core PRIVATE -Wall -Wextra -Wpedantic -Werror)

find_package(SDL2 CONFIG REQUIRED)
add_executable(stackchan-simulator stackchan/host/main.cpp)
target_link_libraries(stackchan-simulator PRIVATE visualizer_core SDL2::SDL2)
target_compile_options(stackchan-simulator PRIVATE -Wall -Wextra -Wpedantic -Werror)

include(CTest)
if(BUILD_TESTING)
  add_executable(visualizer-core-test stackchan/test/visualizer_test.cpp)
  target_link_libraries(visualizer-core-test PRIVATE visualizer_core)
  target_compile_options(visualizer-core-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
  add_test(NAME visualizer-core-test COMMAND visualizer-core-test)
endif()
